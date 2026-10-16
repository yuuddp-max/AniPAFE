import test from "node:test";
import assert from "node:assert/strict";
import { database, call, ADMIN, U1, U2, OTHER } from "./database";
import { matchingNicoId } from "../src/lib/historical-voter-types";
import { readFile, readdir } from "node:fs/promises";

test("過去投票者紐付け：原本保持・年度分離・権限・競合・変更/解除・監査", async () => {
  const { db } = await database();
  try {
    await call(db, U1, "select public.save_profile('ユーザー1','350396')");
    await call(db, U2, "select public.save_profile('ユーザー2','777771')");
    await db.exec(`insert into public.master_poll_settings(id,year,title) values(2025,2025,'過去年度');
      insert into public.data_ballot(year,source,status,source_row,display_name,nico_user_id,source_timestamp,raw_response) values
        (2025,'historical','imported',2,'原本1','350396','元日時','{"secret":"原本維持"}'),
        (2025,'historical','imported',3,'原本2',null,'元日時','{}'),
        (2026,'historical','imported',2,'別年度','777771','元日時','{}');`);
    const rows = (
      await db.query<{ id: string; year: number; source: string }>(
        "select id,year,source from public.data_ballot order by year,source_row nulls last",
      )
    ).rows;
    const original = rows.find((row) => row.year === 2025)!;
    const second = rows.filter((row) => row.year === 2025)[1];
    const site = rows.find((row) => row.source === "site")!;
    const snapshot = async () =>
      (
        await db.query(`select jsonb_build_object(
      'ballots',(select jsonb_agg(to_jsonb(b)-array['voter_id','revision','updated_at'] order by id) from public.data_ballot b),
      'site',(select jsonb_agg(b order by id) from public.data_ballot b where source='site'),
      'entries',(select jsonb_agg(e order by id) from public.data_ballots e),
      'users',(select jsonb_agg(p order by user_id) from public.data_login_user p),
      'settings',(select jsonb_agg(p order by year) from public.master_poll_settings p),
      'target',(select to_jsonb(t) from public.master_event_settings t)) s`)
      ).rows[0];
    const before = await snapshot();
    const revisionBefore = Number(
      (
        await db.query<{ revision: number }>(
          "select revision from private.tally_input_revisions where year=2025",
        )
      ).rows[0].revision,
    );
    const voter = async () =>
      (
        await db.query<{ voter_id: string | null; revision: number }>(
          "select voter_id,revision from public.data_ballot where id=$1",
          [original.id],
        )
      ).rows[0];
    const link = (
      uid: string | null,
      user: string | null = U1,
      rev = 0,
      ballot = original.id,
      year = 2025,
      reason = "本人確認済み",
      role = "authenticated",
    ) =>
      call(
        db,
        uid,
        "select public.admin_link_historical_voter($1,$2,$3,$4,$5) r",
        [ballot, year, user, rev, reason],
        role,
      );
    for (const uid of [U1, U2, OTHER])
      await assert.rejects(link(uid), /運営|権限|Google/);
    await assert.rejects(
      link(null, U1, 0, original.id, 2025, "理由", "anon"),
      /permission denied/,
    );
    await assert.rejects(link(ADMIN, U1, 0, original.id, 2026), /原本/);
    await assert.rejects(link(ADMIN, U1, 0, site.id, site.year), /原本/);
    await assert.rejects(link(ADMIN, OTHER), /ログインユーザー/);
    await assert.rejects(link(ADMIN, U1, 0, original.id, 2025, " "), /理由/);
    assert.equal((await link(ADMIN)).rows.length, 1);
    assert.deepEqual(await voter(), { voter_id: U1, revision: 1 });
    await assert.rejects(link(ADMIN, U2), /更新されました/);
    await link(ADMIN, U2, 1);
    assert.deepEqual(await voter(), { voter_id: U2, revision: 2 });
    await link(ADMIN, null, 2);
    assert.deepEqual(await voter(), { voter_id: null, revision: 3 });
    await assert.rejects(link(ADMIN, U1, 0), /更新されました/);
    await link(ADMIN, U1, 3);
    assert.deepEqual(await voter(), { voter_id: U1, revision: 4 });
    // Multiple original responses and a site ballot may belong to the same person.
    await link(ADMIN, U1, 0, second.id);
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      Number(
        (
          await db.query<{ revision: number }>(
            "select revision from private.tally_input_revisions where year=2025",
          )
        ).rows[0].revision,
      ),
      revisionBefore + 5,
    );
    const stored = (
      await call(
        db,
        ADMIN,
        "select user_id,revision from public.data_historical_voter_links order by revision desc",
      )
    ).rows;
    assert.deepEqual(stored, [
      { user_id: U1, revision: 4 },
      { user_id: U1, revision: 1 },
    ]);
    assert.equal(
      (await call(db, U1, "select * from public.data_historical_voter_links"))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await call(
          db,
          U1,
          "select * from public.data_ballot where source='historical'",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      call(
        db,
        null,
        "select * from public.data_historical_voter_links",
        [],
        "anon",
      ),
      /permission denied/,
    );
    for (const uid of [ADMIN, U1]) {
      await assert.rejects(
        call(
          db,
          uid,
          "update public.data_historical_voter_links set user_id=null",
        ),
        /permission denied/,
      );
      await assert.rejects(
        call(db, uid, "delete from public.data_historical_voter_links"),
        /permission denied/,
      );
      await assert.rejects(
        call(
          db,
          uid,
          "insert into public.data_historical_voter_links(ballot_id,year) values($1,2025)",
          [original.id],
        ),
        /permission denied/,
      );
    }
    const audit = (
      await call(
        db,
        ADMIN,
        "select action,summary,actor,year from public.audit_logs where action like '%historical_voter' order by id",
      )
    ).rows as {
      action: string;
      summary: Record<string, unknown>;
      actor: string;
      year: number;
    }[];
    assert.equal(audit.length, 5);
    assert.equal(audit[2].action, "unlink_historical_voter");
    assert.deepEqual(audit[2].summary, {
      previous_user_id: U2,
      user_id: null,
      revision: 3,
      reason: "本人確認済み",
    });
    assert.ok(audit.every((row) => row.actor === ADMIN && row.year === 2025));
    // FK also rejects linking site ballots through a privileged write.
    await assert.rejects(
      db.query(
        "insert into public.data_historical_voter_links(ballot_id,year,user_id) values($1,$2,$3)",
        [site.id, site.year, U1],
      ),
      /foreign key/,
    );
    await db.query("delete from public.data_ballot where id=$1", [original.id]);
    assert.equal(
      (
        await db.query(
          "select * from public.data_historical_voter_links where ballot_id=$1",
          [original.id],
        )
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("既存紐付けの反映と同年度の複数原本・サイト票共存、プロフィール・下書き保存", async () => {
  const { db } = await database({
    beforeMigration: "sync_historical_ballot_voter",
  });
  try {
    await call(db, U1, "select public.save_profile('同期テスト','350396')");
    await db.exec(`insert into public.data_ballot(year,source,status,source_row,display_name,nico_user_id,source_timestamp,raw_response) values
      (2026,'historical','imported',2,'原本A','9999999','元日時','{"original":"保持"}'),
      (2026,'historical','imported',3,'原本B',null,'元日時','{}');`);
    const originals = (
      await db.query<{ id: string }>(
        "select id from public.data_ballot where source='historical' order by source_row",
      )
    ).rows;
    await call(
      db,
      ADMIN,
      "select public.admin_link_historical_voter($1,2026,$2,0,'既存紐付け')",
      [originals[0].id, U1],
    );
    assert.equal(
      (
        await db.query<{ voter_id: string | null }>(
          "select voter_id from public.data_ballot where id=$1",
          [originals[0].id],
        )
      ).rows[0].voter_id,
      null,
    );
    const migration = (await readdir("supabase/migrations")).find((name) =>
      name.endsWith("_sync_historical_ballot_voter.sql"),
    )!;
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
    assert.equal(
      (
        await db.query<{ voter_id: string | null }>(
          "select voter_id from public.data_ballot where id=$1",
          [originals[0].id],
        )
      ).rows[0].voter_id,
      U1,
    );
    await call(
      db,
      ADMIN,
      "select public.admin_link_historical_voter($1,2026,$2,0,'同じ人の別回答')",
      [originals[1].id, U1],
    );
    assert.equal(
      (
        await db.query(
          "select * from public.data_ballot where year=2026 and voter_id=$1",
          [U1],
        )
      ).rows.length,
      3,
    );
    await call(db, U1, "select public.save_profile('同期テスト','350396')");
    const site = (
      await db.query<{ revision: number }>(
        "select revision from public.data_ballot where source='site' and voter_id=$1 and year=2026",
        [U1],
      )
    ).rows[0];
    await call(db, U1, "select public.save_draft('[]'::jsonb,$1)", [
      site.revision,
    ]);
    await assert.rejects(
      db.query(
        "insert into public.data_ballot(year,voter_id) values(2026,$1)",
        [U1],
      ),
      /unique/,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.data_ballot where source='site' and year=2026 and voter_id=$1",
          [U1],
        )
      ).rows.length,
      1,
    );
    await db.exec(
      "insert into public.master_poll_settings(id,year,title) values(2027,2027,'次年度'); update public.master_event_settings set target_year=2027 where id=1;",
    );
    const history = await call(
      db,
      U1,
      "select public.vote_history(2026) result",
    );
    assert.equal(history.rows.length, 1);
    const historyResult = (
      history.rows[0] as {
        result: { ballot: { source: string }; years: unknown[] };
      }
    ).result;
    assert.equal(historyResult.ballot.source, "site");
    assert.equal(historyResult.years.length, 1);
    assert.equal(
      (
        await call(
          db,
          U1,
          "select * from public.data_ballot where source='historical'",
        )
      ).rows.length,
      0,
    );
    // Removing a mapping via a trusted import clears only the corresponding original.
    await db.query(
      "delete from public.data_historical_voter_links where ballot_id=$1",
      [originals[1].id],
    );
    assert.equal(
      (
        await db.query<{ voter_id: string | null }>(
          "select voter_id from public.data_ballot where id=$1",
          [originals[1].id],
        )
      ).rows[0].voter_id,
      null,
    );
    assert.equal(
      (
        await db.query<{ nico_user_id: string }>(
          "select nico_user_id from public.data_ballot where id=$1",
          [originals[0].id],
        )
      ).rows[0].nico_user_id,
      "9999999",
    );
  } finally {
    await db.close();
  }
});

test("ニコニコID候補：空欄や文字列は一致させず、空白・先頭ゼロを正規化", () => {
  assert.equal(matchingNicoId(" 000350396 ", "350396"), true);
  for (const [a, b] of [
    [null, null],
    ["", ""],
    ["abc", "abc"],
    ["123", "124"],
  ])
    assert.equal(matchingNicoId(a, b), false);
});
