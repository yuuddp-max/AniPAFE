import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, U1, U2, ADMIN, OTHER } from "./database";

test("過去フォームをID・原文ごと統合し、サイト投票の制約・認可・保存確定を維持する", async () => {
  const { db, videos } = await database({
    beforeMigration: "merge_historical_ballots",
  });
  try {
    await call(db, U1, "select public.save_profile('現行投票者','999999990')");
    const entries = minimum(videos);
    await call(db, U1, "select public.save_draft($1,1)", [
      JSON.stringify(entries),
    ]);
    await db.exec(
      "insert into public.master_poll_settings(id,year,title) values(2025,2025,'過去年度')",
    );
    await db.query<Record<string, unknown>>(
      `insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,theme,watch_url,is_active)
      select 2025,video_id,display_order,title,author_nico_user_id,author_name,theme,watch_url,is_active from public.data_mad where year=2026 and video_id=$1`,
      [videos[0].video_id],
    );
    const past = (
      await db.query<{
        id: string;
      }>(`insert into public.data_historical_ballot(year,source_row,display_name,nico_user_id,created_at,source_timestamp,raw_response)
      values(2025,2,'元回答者','999999990','2025-10-01T14:42:45Z','元の日時','{"原文":"<script>原文</script>","空欄":null}') returning id`)
    ).rows[0].id;
    await db.query<Record<string, unknown>>(
      `insert into public.data_historical_ballots(ballot_id,year,award_code,slot,source_video_number,source_video_label,video_id,comment,selection_column,comment_column) values
      ($1,2025,'overall',1,1,'001 元作品',$2,$3,'総合1','感想1'),
      ($1,2025,'overall',2,1,'001 元作品',$2,'同作品の別枠','総合2','感想2'),
      ($1,2025,'humor',1,72,'072 削除済み作品',null,'作品未対応','諧謔1','感想51'),
      ($1,2025,'creative',1,null,null,null,'選択なしの感想','創作1','感想41')`,
      [past, videos[0].video_id, "あ".repeat(1073)],
    );
    const oldBallot = (
      await db.query<Record<string, unknown>>(
        "select to_jsonb(t) r from public.data_historical_ballot t",
      )
    ).rows[0].r as Record<string, unknown>;
    const oldEntries = (
      await db.query<Record<string, unknown>>(
        "select to_jsonb(t) r from public.data_historical_ballots t order by id",
      )
    ).rows.map((r) => r.r) as Record<string, unknown>[];
    const siteBefore = (
      await db.query<Record<string, unknown>>(
        "select to_jsonb(t) r from public.data_ballot t where voter_id=$1",
        [U1],
      )
    ).rows[0].r as Record<string, unknown>;
    const migration = (await readdir("supabase/migrations")).find((n) =>
      n.endsWith("_merge_historical_ballots.sql"),
    )!;
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
    for (const name of [
      "data_historical_ballot",
      "data_historical_ballots",
      "data_historical_imports",
    ])
      assert.equal(
        (
          await db.query<Record<string, unknown>>("select to_regclass($1) r", [
            `public.${name}`,
          ])
        ).rows[0].r,
        null,
      );
    const migrated = (
      await db.query<Record<string, unknown>>(
        "select to_jsonb(t) r from public.data_ballot t where id=$1",
        [past],
      )
    ).rows[0].r as Record<string, unknown>;
    for (const [key, value] of Object.entries(oldBallot))
      assert.deepEqual(migrated[key], value, key);
    assert.equal(migrated.voter_id, null);
    assert.equal(migrated.source, "historical");
    assert.equal(migrated.status, "imported");
    const saved = (
      await db.query<Record<string, unknown>>(
        "select to_jsonb(t) r from public.data_ballots t where ballot_id=$1 order by id",
        [past],
      )
    ).rows.map((r) => r.r) as Record<string, unknown>[];
    for (let i = 0; i < oldEntries.length; i++)
      for (const [key, value] of Object.entries(oldEntries[i]))
        assert.deepEqual(saved[i][key], value, key);
    const siteAfter = (
      await db.query<Record<string, unknown>>(
        "select to_jsonb(t) r from public.data_ballot t where voter_id=$1",
        [U1],
      )
    ).rows[0].r as Record<string, unknown>;
    for (const [key, value] of Object.entries(siteBefore))
      assert.deepEqual(siteAfter[key], value, key);
    for (const uid of [U1, U2, OTHER]) {
      assert.equal(
        (
          await call(
            db,
            uid,
            "select * from public.data_ballot where source='historical'",
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await call(
            db,
            uid,
            "select * from public.data_ballots where source='historical'",
          )
        ).rows.length,
        0,
      );
    }
    assert.equal(
      (
        await call(
          db,
          ADMIN,
          "select * from public.data_ballots where source='historical'",
        )
      ).rows.length,
      4,
    );
    await assert.rejects(
      call(db, null, "select * from public.data_ballot", [], "anon"),
      /permission/,
    );
    await assert.rejects(
      call(db, ADMIN, "update public.data_ballot set voter_id=$1 where id=$2", [
        U1,
        past,
      ]),
      /permission/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>(
        "update public.data_ballot set status='submitted',submitted_at=now() where id=$1",
        [past],
      ),
      /check/,
    );
    const siteId = String(siteAfter.id);
    await assert.rejects(
      db.query<Record<string, unknown>>(
        `insert into public.data_ballots(ballot_id,year,award_code,video_id,source,slot,source_video_number,source_video_label,selection_column,comment_column)
      values($1,2026,'overall',$2,'historical',1,1,'001','選択','感想')`,
        [siteId, videos[0].video_id],
      ),
      /foreign key/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>(
        "insert into public.data_ballots(ballot_id,year,award_code,video_id,comment) values($1,2026,'overall',$2,$3)",
        [siteId, videos[1].video_id, "あ".repeat(1001)],
      ),
      /check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>(
        "insert into public.data_ballots(ballot_id,year,award_code,video_id) values($1,2026,'overall',null)",
        [siteId],
      ),
      /check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>(
        "insert into public.data_ballots(ballot_id,year,award_code,video_id) select ballot_id,year,award_code,video_id from public.data_ballots where ballot_id=$1 limit 1",
        [siteId],
      ),
      /duplicate/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>(
        "update public.data_ballots set year=2026 where ballot_id=$1",
        [past],
      ),
      /foreign key/,
    );
    const report = (
      (await call(db, ADMIN, "select public.admin_report() r")).rows[0] as {
        r: { stats: { submitted: number } };
      }
    ).r;
    assert.equal(report.stats.submitted, 0);
    const history = (
      (await call(db, U1, "select public.vote_history(2025) h")).rows[0] as {
        h: { ballot: unknown; entries: unknown[] };
      }
    ).h;
    assert.equal(history.ballot, null);
    assert.deepEqual(history.entries, []);
    await call(db, U1, "select public.submit_ballot(2)");
    const afterSubmit = (
      (await call(db, ADMIN, "select public.admin_report() r")).rows[0] as {
        r: { stats: { submitted: number }; details: unknown[] };
      }
    ).r;
    assert.equal(afterSubmit.stats.submitted, 1);
    assert.equal(afterSubmit.details.length, entries.length);
    assert.equal(
      (
        await db.query<Record<string, unknown>>(
          "select count(*)::int n from public.data_ballots where source='historical'",
        )
      ).rows[0].n,
      4,
    );
  } finally {
    await db.close();
  }
});
