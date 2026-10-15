import test from "node:test";
import assert from "node:assert/strict";
import { database, call, U1, ADMIN } from "./database";
import { tally } from "../src/lib/tally";

test("保存集計：運営専用RLS・条件別保存・更新検知・競合拒否・年度削除", async () => {
  const { db } = await database();
  try {
    await db.exec(
      "insert into public.master_poll_settings(id,year,title) values(2025,2025,'保存検証');",
    );
    const state = async (year = 2026, source = "auto") => {
      const row = (
        await call(db, ADMIN, "select public.admin_tally_state($1,$2) s", [
          year,
          source,
        ])
      ).rows[0] as { s: { revision: string; source: string } };
      return row.s;
    };
    const snapshot = (year: number, source: string, denominator = 143) => ({
      ...tally({
        year,
        source,
        ballotCount: 0,
        works: [],
        entries: [],
        scoreDenominator: denominator,
      }),
      historical_ballot_count: 0,
      historical_selection_count: 0,
      details: [{ comment: "運営限定の感想", nico_user_id: "12345" }],
    });
    const save = async (
      revision: string,
      year = 2026,
      source = "site",
      denominator = 143,
      version = 1,
    ) => {
      const row = (
        await call(
          db,
          ADMIN,
          "select public.admin_save_tally_result($1,$2,$3,$4,$5,$6) saved",
          [
            year,
            source,
            denominator,
            version,
            revision,
            JSON.stringify(snapshot(year, source, denominator)),
          ],
        )
      ).rows[0] as { saved: string | null };
      return row.saved;
    };
    const before = await state();
    assert.equal(before.source, "site");
    assert.ok(await save(before.revision));
    assert.ok(await save(before.revision, 2026, "historical"));
    assert.ok(await save(before.revision, 2026, "site", 100));
    assert.ok(await save(before.revision, 2026, "site", 143, 2));
    assert.equal(
      (await call(db, ADMIN, "select * from public.data_tally_results")).rows
        .length,
      4,
    );
    assert.equal(
      (await call(db, U1, "select * from public.data_tally_results")).rows
        .length,
      0,
    );
    await assert.rejects(
      call(db, null, "select * from public.data_tally_results", [], "anon"),
      /permission/,
    );
    for (const uid of [U1, null]) {
      const role = uid ? "authenticated" : "anon";
      await assert.rejects(
        call(db, uid, "select public.admin_summary()", [], role),
        /権限|permission/,
      );
      await assert.rejects(
        call(db, uid, "select public.admin_tally_state(2026,'auto')", [], role),
        /権限|permission/,
      );
      await assert.rejects(
        call(
          db,
          uid,
          "select public.admin_save_tally_result(2026,'site',143,1,0,'{}')",
          [],
          role,
        ),
        /権限|permission/,
      );
    }
    const summary = (await call(db, ADMIN, "select public.admin_summary() s"))
      .rows[0] as {
      s: { year: number; stats: { videos: number }; rankings?: unknown };
    };
    assert.equal(summary.s.year, 2026);
    assert.ok(summary.s.stats.videos > 0);
    assert.equal(summary.s.rankings, undefined);
    await assert.rejects(
      call(db, ADMIN, "update public.data_tally_results set result='{}'"),
      /permission/,
    );
    await assert.rejects(
      call(db, ADMIN, "select revision from private.tally_input_revisions"),
      /permission/,
    );
    await assert.rejects(
      call(db, ADMIN, "select private.invalidate_tally_results()"),
      /permission/,
    );
    await assert.rejects(
      call(
        db,
        ADMIN,
        "select public.admin_save_tally_result(2026,'site',143,1,$1,'{}')",
        [before.revision],
      ),
      /形式/,
    );

    // Bulk import increments once, and auto now resolves the historical source.
    const older = await state(2025);
    await db.exec(`insert into public.data_ballot(year,status,source,source_row,display_name,source_timestamp,raw_response)
      select 2025,'imported','historical',n,'検証投票者','検証日時','{}' from generate_series(2,51) n;`);
    const imported = await state(2025);
    assert.equal(BigInt(imported.revision), BigInt(older.revision) + 1n);
    assert.equal(imported.source, "historical");
    assert.equal((await state()).revision, before.revision);
    assert.equal(await save(older.revision, 2025, "historical"), null);
    assert.ok(await save(imported.revision, 2025, "historical"));
    await db.exec(
      "update public.data_ballot set display_name='改名' where year=2025;",
    );
    assert.equal(await save(imported.revision, 2025, "historical"), null);

    await db.exec(`insert into public.data_ballots(ballot_id,year,source,award_code,source_video_number,source_video_label,slot,selection_column,comment_column)
      select id,2025,'historical','overall',1,'作品1',1,'選択','感想' from public.data_ballot where year=2025;`);
    const entriesRevision = (await state(2025)).revision;
    await db.exec(
      "update public.data_ballots set comment='感想訂正' where year=2025;",
    );
    assert.notEqual((await state(2025)).revision, entriesRevision);
    const deleteRevision = (await state(2025)).revision;
    await db.exec("delete from public.data_ballots where year=2025;");
    assert.notEqual((await state(2025)).revision, deleteRevision);
    const workRevision = (await state()).revision;
    await db.exec(
      "update public.data_mad set author_nico_user_id='888888',title=title||'更新' where year=2026 and display_order=1;",
    );
    assert.notEqual((await state()).revision, workRevision);
    assert.equal(await save(workRevision), null);

    // Identity changes invalidate all years in which that voter has a site ballot.
    await call(db, U1, "select public.save_profile('投票者','350396')");
    await db.exec(
      `insert into public.data_ballot(year,voter_id) values(2026,'${U1}'),(2025,'${U1}') on conflict do nothing;`,
    );
    const profile26 = (await state()).revision;
    const profile25 = (await state(2025)).revision;
    await db.exec(
      `update public.data_profiles set nico_user_id='888889' where user_id='${U1}';`,
    );
    assert.notEqual((await state()).revision, profile26);
    assert.notEqual((await state(2025)).revision, profile25);
    const truncated = (await state()).revision;
    await db.exec("truncate public.data_ballots;");
    assert.notEqual((await state()).revision, truncated);

    await db.exec(
      "delete from public.data_ballot where year=2025; delete from public.master_award_types where year=2025; delete from public.master_poll_settings where year=2025;",
    );
    assert.equal(
      (
        await db.query(
          "select * from public.data_tally_results where year=2025",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(state(2025), /年度/);
  } finally {
    await db.close();
  }
});
