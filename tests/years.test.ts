import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, U1, U2, ADMIN, OTHER } from "./database";
import type { VoteHistory } from "../src/lib/types";

test("年度移行で既存票を保持し、年度別の作品・投票・公開結果と権限を分離する", async () => {
  const { db, videos } = await database({
    beforeMigration: "multi_year_voting",
  });
  try {
    await call(db, U1, "select public.save_profile('年度テスト','350396')");
    const choices = minimum(videos);
    await call(db, U1, "select public.save_draft($1,1)", [
      JSON.stringify(choices),
    ]);
    await call(db, U1, "select public.submit_ballot(2)");
    const before = (
      await db.query("select * from public.data_ballots order by id")
    ).rows;
    const migration = (await readdir("supabase/migrations")).find((name) =>
      name.endsWith("_multi_year_voting.sql"),
    )!;
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
    const after = (
      await db.query<Record<string, unknown>>(
        "select * from public.data_ballots order by id",
      )
    ).rows;
    assert.deepEqual(
      after.map(({ year, ...row }) => row),
      before,
    );
    assert.ok(after.every((r) => r.year === 2026));
    const manage = (
      action: string,
      year: number,
      expected: number,
      title = `AniPAFE${year} 人気投票`,
      results = false,
    ) =>
      call(db, ADMIN, "select public.manage_year($1,$2,$3,$4,$5,false,$6,$7)", [
        action,
        year,
        title,
        "2025-01-01T00:00:00Z",
        "2025-12-31T00:00:00Z",
        results,
        expected,
      ]);
    await assert.rejects(
      call(
        db,
        U1,
        "select public.manage_year('create',2027,'不正',null,null,false,false,2026)",
      ),
      /運営者/,
    );
    await manage("create", 2027, 2026);
    await assert.rejects(manage("create", 2027, 2026), /duplicate/);
    await manage("switch", 2027, 2026);
    await assert.rejects(
      call(db, U1, "select public.save_draft('[]',0,2026)"),
      /対象年度/,
    );
    await assert.rejects(
      call(db, U1, "select public.save_draft('[]',0)"),
      /対象年度/,
    ); // Legacy clients are pinned to 2026.
    await assert.rejects(
      call(db, U1, "select public.submit_ballot(0,2026)"),
      /対象年度/,
    );
    await assert.rejects(
      call(db, ADMIN, "select public.admin_thumbnail($1,null,2026)", [
        videos[0].video_id,
      ]),
      /対象年度/,
    );
    await assert.rejects(manage("settings", 2027, 2026), /対象年度/);
    const master = (
      await db.query<{ n: number }>(
        "select master_revision n from public.master_poll_settings where year=2027",
      )
    ).rows[0].n;
    const nextVideos = videos.map((v) => ({ ...v, title: `翌年の${v.title}` }));
    await call(db, ADMIN, "select public.admin_import($1,$2,2027)", [
      JSON.stringify(nextVideos),
      master,
    ]);
    const original = (
      await db.query<{ title: string }>(
        "select title from public.data_mad where year=2026 order by display_order limit 1",
      )
    ).rows[0].title;
    assert.equal(original, videos[0].title);
    await db.exec(
      "update public.master_poll_settings set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day',is_published=true where year=2027",
    );
    // Existing profiles vote in a new year without registering again.
    await call(db, U1, "select public.save_draft($1,0,2027)", [
      JSON.stringify(choices),
    ]);
    await call(db, U1, "select public.submit_ballot(1,2027)");
    const report = (await call(db, ADMIN, "select public.admin_report() r"))
      .rows[0] as {
      r: {
        year: number;
        stats: { submitted: number };
        rankings: { title: string; votes: number }[];
      };
    };
    assert.equal(report.r.year, 2027);
    assert.equal(report.r.stats.submitted, 1);
    assert.ok(
      report.r.rankings.every(
        (r) => r.title.startsWith("翌年の") && r.votes <= 1,
      ),
    );
    await assert.rejects(
      call(db, U2, "select * from public.data_ballot where voter_id=$1", [
        U1,
      ]).then((r) => assert.equal(r.rows.length, 1)),
      /0 !== 1/,
    );
    const history = async (uid: string, year = 2026) =>
      (
        (await call(db, uid, "select public.vote_history($1) r", [year]))
          .rows[0] as { r: VoteHistory }
      ).r;
    let h = await history(U1);
    assert.equal(h.entries?.length, choices.length);
    assert.equal(h.ballot?.status, "submitted");
    assert.deepEqual(h.rankings, []);
    assert.equal(h.results_public, false);
    assert.equal((await history(U2)).entries?.length, 0);
    assert.equal((await history(U2)).ballot, null);
    assert.equal((await history(ADMIN)).entries?.length, 0); // This endpoint always returns the caller's ballot.
    await assert.rejects(history(OTHER), /Google/);
    await assert.rejects(
      call(db, null, "select public.vote_history()", [], "anon"),
      /permission/,
    );
    await assert.rejects(history(U1, 2027), /過去年度/);
    // Same video ID in another year's entry is rejected by composite foreign keys.
    await assert.rejects(
      db.exec("update public.data_ballots set year=2027 where year=2026"),
      /foreign key/,
    );
    // Switching and editing the next year has not changed any previous entry.
    assert.deepEqual(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.data_ballots where year=2026 order by id",
        )
      ).rows.map(({ year, ...row }) => row),
      before,
    );
    await manage("switch", 2026, 2027);
    await manage("settings", 2026, 2026, "2026年 思い出の人気投票", true);
    await manage("switch", 2027, 2026);
    h = await history(U1);
    assert.equal(h.poll?.title, "2026年 思い出の人気投票");
    assert.equal(h.results_public, true);
    assert.ok(h.rankings?.some((r) => r.votes === 1));
    const publicJson = JSON.stringify(h.rankings);
    assert.ok(
      !publicJson.includes("comment") &&
        !publicJson.includes("nico_user_id") &&
        !publicJson.includes("display_name"),
    );
    const header = await call(
      db,
      null,
      "select public.poll_header() r",
      [],
      "anon",
    );
    assert.deepEqual((header.rows[0] as { r: unknown }).r, {
      year: 2027,
      title: "AniPAFE2027 人気投票",
    });
    await assert.rejects(
      call(db, U1, "update public.master_event_settings set target_year=2026"),
      /permission/,
    );
    await assert.rejects(
      manage("settings", 2027, 2027, " "),
      /check constraint/,
    );
    await assert.rejects(
      call(
        db,
        ADMIN,
        "select public.manage_year('settings',2027,'早期公開',now(),now()+interval '1 day',true,true,2027)",
      ),
      /終了後/,
    );
  } finally {
    await db.close();
  }
});
