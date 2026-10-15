import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, U1, ADMIN } from "./database";

test("部門を年度別に複製し、投票・履歴・集計・新年度・外部キーを年度で分離する", async () => {
  const { db, videos } = await database({
    beforeMigration: "yearly_award_types",
  });
  try {
    await db.exec(
      "insert into public.master_poll_settings(id,year,title) values(2025,2025,'過去年度')",
    );
    await call(db, U1, "select public.save_profile('年度別部門','999999990')");
    const choices = minimum(videos);
    await call(db, U1, "select public.save_draft($1,1)", [
      JSON.stringify(choices),
    ]);
    await call(db, U1, "select public.submit_ballot(2)");
    const video = videos[0].video_id;
    await db.query(
      `insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,theme,watch_url,is_active)
      select 2025,video_id,display_order,title,author_nico_user_id,author_name,theme,watch_url,is_active from public.data_mad where year=2026 and video_id=$1`,
      [video],
    );
    const past = (
      await db.query<{ id: string }>(
        `insert into public.data_ballot(voter_id,year,status,submitted_at)
      values($1,2025,'submitted','2025-10-15T14:00:00Z') returning id`,
        [U1],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.data_ballots(ballot_id,year,award_code,video_id,comment) values($1,2025,'overall',$2,'過去の感想')",
      [past, video],
    );
    const historical = (
      await db.query<{ id: string }>(`insert into public.data_historical_ballot
      (year,source_row,display_name,created_at,source_timestamp,raw_response)
      values(2025,2,'過去フォーム回答者','2025-10-15T14:00:00Z','元日時','{}') returning id`)
    ).rows[0].id;
    await db.query(
      `insert into public.data_historical_ballots(ballot_id,year,award_code,slot,source_video_number,source_video_label,video_id,comment,selection_column,comment_column)
      values($1,2025,'overall',1,1,'001 元ラベル',$2,'保持する感想','（1/10）','感想_01')`,
      [historical, video],
    );
    const snapshot = async () =>
      (
        await db.query(`select jsonb_build_object(
      'entries',(select jsonb_agg(to_jsonb(t) order by id) from public.data_ballots t),
      'historical',(select jsonb_agg(to_jsonb(t) order by id) from public.data_historical_ballots t)) s`)
      ).rows[0];
    const before = await snapshot();
    const migration = (await readdir("supabase/migrations")).find((n) =>
      n.endsWith("_yearly_award_types.sql"),
    )!;
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await db.query(
          "select year,count(*)::int n from public.master_award_types group by year order by year",
        )
      ).rows,
      [
        { year: 2025, n: 6 },
        { year: 2026, n: 6 },
      ],
    );
    assert.equal(
      (await call(db, U1, "select * from public.master_award_types")).rows
        .length,
      6,
    );
    assert.equal(
      (await call(db, ADMIN, "select * from public.master_award_types")).rows
        .length,
      6,
    );
    await assert.rejects(
      call(db, null, "select * from public.master_award_types", [], "anon"),
      /permission/,
    );
    await assert.rejects(
      call(db, ADMIN, "update public.master_award_types set name='不正'"),
      /permission/,
    );
    await db.exec(
      "update public.master_award_types set name='2025総合賞',min_votes=1,max_votes=2 where year=2025 and code='overall'",
    );
    const history = (await call(db, U1, "select public.vote_history(2025) h"))
      .rows[0] as { h: { entries: { award_name: string }[] } };
    assert.equal(history.h.entries.length, 1);
    assert.equal(history.h.entries[0].award_name, "2025総合賞");
    const ranks = (
      await db.query<{ r: { award_name: string }[] }>(
        "select private.year_rankings(2025) r",
      )
    ).rows[0].r;
    assert.ok(ranks.some((r) => r.award_name === "2025総合賞"));
    const report = (await call(db, ADMIN, "select public.admin_report() r"))
      .rows[0] as {
      r: {
        details: unknown[];
        rankings: { award_name: string; votes: number }[];
      };
    };
    assert.equal(report.r.details.length, choices.length);
    assert.ok(
      report.r.rankings.every(
        (r) => r.award_name !== "2025総合賞" && r.votes <= 1,
      ),
    );
    await db.exec(
      "update public.master_award_types set min_votes=6 where year=2026 and code='overall'",
    );
    await assert.rejects(
      db.query("select private.validate_entries($1,$2,true)", [
        U1,
        JSON.stringify(choices),
      ]),
      /6～10/,
    );
    await db.exec(
      "update public.master_award_types set min_votes=5 where year=2026 and code='overall'",
    );
    await db.query("select private.validate_entries($1,$2,true)", [
      U1,
      JSON.stringify(choices),
    ]);
    await call(
      db,
      ADMIN,
      "select public.manage_year('create',2027,'新年度',null,null,false,false,2026)",
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.master_award_types where year=2027",
        )
      ).rows[0].n,
      6,
    );
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from public.master_award_types where year=2027 and code='overall'",
        )
      ).rows[0].name,
      "総合賞",
    );
    await db.exec(
      "delete from public.master_award_types where year=2027 and code='music'",
    );
    const next = (
      await db.query<{ id: string }>(
        "insert into public.data_historical_ballot(year,source_row,display_name,created_at,source_timestamp,raw_response) values(2027,2,'別年度',now(),'raw','{}') returning id",
      )
    ).rows[0].id;
    await assert.rejects(
      db.query(
        `insert into public.data_historical_ballots(ballot_id,year,award_code,slot,source_video_number,source_video_label,selection_column,comment_column)
      values($1,2027,'music',1,72,'072 元ラベル','x','y')`,
        [next],
      ),
      /foreign key/,
    );
    await assert.rejects(
      db.query(
        "delete from public.master_award_types where year=2025 and code='overall'",
      ),
      /foreign key/,
    );
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.close();
  }
});
