import test from "node:test";
import assert from "node:assert/strict";
import { database, call, ADMIN, U1, U2, OTHER } from "./database";
import {
  initialVoteSource,
  isOriginalSelection,
} from "../src/lib/original-votes";
import type { LinkedOriginalVote, VoteData } from "../src/lib/types";

test("紐付け原本は本人の選択・感想のみ取得、原本とサイト票を保持し他人・匿名を拒否", async () => {
  const { db, videos } = await database();
  try {
    await call(db, U1, "select public.save_profile('本人','350396')");
    await call(db, U2, "select public.save_profile('他人','777771')");
    await db.exec(`insert into public.data_ballot(year,source,status,source_row,display_name,source_timestamp,raw_response) values
      (2026,'historical','imported',2,'非公開の原本名前','元日時','{"secret":"not-for-client"}'),
      (2026,'historical','imported',3,'他人の原本','元日時','{}');`);
    const originals = (
      await db.query<{ id: string }>(
        "select id from public.data_ballot where source='historical' order by source_row",
      )
    ).rows;
    await db.query(
      `insert into public.data_ballots(ballot_id,year,source,award_code,slot,video_id,source_video_number,source_video_label,selection_column,comment_column,comment) values
      ($1,2026,'historical','overall',1,$3,1,'原本ラベル','選択1','感想1','本人の感想'),
      ($1,2026,'historical','overall',2,$3,1,'重複した原本ラベル','選択2','感想2','同作品の別枠'),
      ($1,2026,'historical','music',1,null,999,'未対応の原本作品','選択3','感想3','長い感想' || repeat('あ',1100)),
      ($1,2026,'historical','creative',1,null,null,null,'選択4','感想4','選択なしの感想'),
      ($2,2026,'historical','overall',1,$3,1,'他人の選択','選択1','感想1','他人だけの感想')`,
      [originals[0].id, originals[1].id, videos[0].video_id],
    );
    for (const [index, user] of [U1, U2].entries())
      await call(
        db,
        ADMIN,
        "select public.admin_link_historical_voter($1,2026,$2,0,'本人確認')",
        [originals[index].id, user],
      );
    const snapshot = async () =>
      (
        await db.query(
          "select md5(string_agg(to_jsonb(b)::text,'' order by id)) hash from public.data_ballot b",
        )
      ).rows;
    const before = await snapshot();
    const read = async (
      uid: string | null,
      year = 2026,
      role = "authenticated",
    ) =>
      call(
        db,
        uid,
        "select public.linked_original_votes($1) result",
        [year],
        role,
      );
    const mine = (await read(U1)).rows[0] as { result: LinkedOriginalVote[] };
    assert.equal(mine.result.length, 1);
    assert.equal(mine.result[0].entries.length, 4);
    assert.equal(mine.result[0].entries.filter(isOriginalSelection).length, 3);
    assert.equal(
      mine.result[0].entries.find((e) => e.award_code === "music")?.title,
      "未対応の原本作品",
    );
    assert.ok(mine.result[0].entries.some((e) => e.comment.length > 1000));
    for (const secret of [
      "secret",
      "raw_response",
      "not-for-client",
      "非公開の原本名前",
      "他人だけの感想",
    ])
      assert.ok(!JSON.stringify(mine).includes(secret));
    assert.equal(
      ((await read(U2)).rows[0] as { result: LinkedOriginalVote[] }).result[0]
        .entries[0].comment,
      "他人だけの感想",
    );
    assert.deepEqual(
      ((await read(ADMIN)).rows[0] as { result: unknown[] }).result,
      [],
    );
    await assert.rejects(read(null, 2026, "anon"), /permission denied/);
    await assert.rejects(read(OTHER), /Google/);
    await assert.rejects(read(U1, 2025), /対象年度/);
    assert.equal(
      (
        await call(
          db,
          U1,
          "select * from public.data_ballots where source='historical'",
        )
      ).rows.length,
      0,
    );
    assert.deepEqual(await snapshot(), before);
    await call(
      db,
      ADMIN,
      "select public.admin_link_historical_voter($1,2026,null,1,'解除')",
      [originals[0].id],
    );
    assert.deepEqual(
      ((await read(U1)).rows[0] as { result: unknown[] }).result,
      [],
    );
  } finally {
    await db.close();
  }
});

test("原本表示の既定：未入力なら原本、サイトに保存した選択や確定票があればそちらを保持", () => {
  const data = {
    entries: [],
    ballot: null,
    linkedOriginals: [{ id: "original" }],
  } as unknown as VoteData;
  assert.equal(initialVoteSource(data), "original");
  assert.equal(
    initialVoteSource({
      ...data,
      entries: [{ award_code: "overall", video_id: "sm1", comment: "" }],
    }),
    "site",
  );
  assert.equal(
    initialVoteSource({
      ...data,
      ballot: { status: "submitted" } as VoteData["ballot"],
    }),
    "site",
  );
  assert.equal(initialVoteSource({ ...data, linkedOriginals: [] }), "site");
});
