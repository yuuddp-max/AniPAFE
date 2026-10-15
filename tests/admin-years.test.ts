import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, ADMIN, U1, U2 } from "./database";

test("年度別の運営編集は対象年度を変えず、別年度と原本を保持し、認可・競合・確定票を保護する", async () => {
  const { db, videos } = await database({
    beforeMigration: "independent_admin_years",
  });
  try {
    const snapshot = async (year?: number) =>
      (
        await db.query<{ state: unknown }>(`select jsonb_build_object(
      'videos',(select jsonb_agg(to_jsonb(v) order by year,video_id) from public.data_mad v ${year ? "where year=" + year : ""}),
      'ballots',(select jsonb_agg(to_jsonb(b) order by id) from public.data_ballot b ${year ? "where year=" + year : ""}),
      'entries',(select jsonb_agg(to_jsonb(e) order by id) from public.data_ballots e ${year ? "where year=" + year : ""}),
      'polls',(select jsonb_agg(to_jsonb(p) order by year) from public.master_poll_settings p ${year ? "where year=" + year : ""}),
      'event',(select to_jsonb(s) from public.master_event_settings s where id=1)) state`)
      ).rows[0].state;
    const before = await snapshot();
    const migration = (await readdir("supabase/migrations")).find((n) =>
      n.endsWith("_independent_admin_years.sql"),
    )!;
    await db.exec(await readFile("supabase/migrations/" + migration, "utf8"));
    assert.deepEqual(await snapshot(), before);
    const signatures = [
      ["admin_year_import", "$1,0,2026", [JSON.stringify(videos)]],
      ["admin_year_reopen", "$1,'理由',2026", [U1]],
      ["admin_year_thumbnail", "$1,null,2026", [videos[0].video_id]],
      ["admin_year_profile", "$1,'12345','理由',2026", [U1]],
    ] as const;
    for (const [name, args, params] of signatures) {
      await assert.rejects(
        call(db, U1, `select public.${name}(${args})`, [...params]),
        /運営者/,
      );
      await assert.rejects(
        call(db, null, `select public.${name}(${args})`, [...params], "anon"),
        /permission/,
      );
    }
    await assert.rejects(
      call(db, ADMIN, "select public.admin_year_thumbnail($1,null,2024)", [
        videos[0].video_id,
      ]),
      /年度が登録/,
    );
    await call(db, U1, "select public.save_profile('年度投票者','350396')");
    await call(db, U2, "select public.save_profile('他の投票者','777771')");
    const choices = minimum(videos);
    await call(db, U1, "select public.save_draft($1,1,2026)", [
      JSON.stringify(choices),
    ]);
    await call(db, U1, "select public.submit_ballot(2,2026)");
    await call(
      db,
      ADMIN,
      "select public.manage_year('create',2025,'過去年度',null,null,false,false,2026)",
    );
    await call(
      db,
      ADMIN,
      "select public.manage_year('switch',2025,'',null,null,false,false,2026)",
    );
    const revision = async () =>
      (
        await db.query<{ master_revision: number }>(
          "select master_revision from public.master_poll_settings where year=2025",
        )
      ).rows[0].master_revision;
    await call(db, ADMIN, "select public.admin_year_import($1,$2,2025)", [
      JSON.stringify(videos.map((v) => ({ ...v, title: "過去の" + v.title }))),
      await revision(),
    ]);
    await db.exec(
      "update public.master_poll_settings set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day',is_published=true where year=2025",
    );
    await call(db, U1, "select public.save_draft($1,0,2025)", [
      JSON.stringify(choices),
    ]);
    await call(db, U1, "select public.submit_ballot(1,2025)");
    await db.exec(`insert into public.data_ballot(year,source,status,source_row,display_name,source_timestamp,raw_response) values(2025,'historical','imported',2,'原本回答者','元日時','{"original":true}');
      insert into public.data_ballots(ballot_id,year,source,award_code,slot,source_video_number,source_video_label,selection_column,comment_column)
      select id,year,'historical','overall',1,1,'保存原本','選択','感想' from public.data_ballot where source='historical';`);
    const originals = async () =>
      (
        await db.query(
          "select to_jsonb(b) original from public.data_ballot b where source='historical' union all select to_jsonb(e) from public.data_ballots e where source='historical'",
        )
      ).rows;
    const originalBefore = await originals();
    await call(
      db,
      ADMIN,
      "select public.manage_year('switch',2026,'',null,null,false,false,2025)",
    );
    const currentBefore = await snapshot(2026);
    const rev = await revision();
    const changed = { ...videos[0], title: "2025年度だけの編集" };
    await call(db, ADMIN, "select public.admin_year_import($1,$2,2025)", [
      JSON.stringify([changed]),
      rev,
    ]);
    assert.deepEqual(await snapshot(2026), currentBefore);
    await assert.rejects(
      call(db, ADMIN, "select public.admin_year_import($1,$2,2025)", [
        JSON.stringify([changed]),
        rev,
      ]),
      /作品マスターが更新/,
    );
    const voted = videos.find((v) => v.video_id === choices[0].video_id)!;
    await assert.rejects(
      call(db, ADMIN, "select public.admin_year_import($1,$2,2025)", [
        JSON.stringify([{ ...voted, is_active: false }]),
        await revision(),
      ]),
      /無効な作品/,
    );
    await call(
      db,
      ADMIN,
      "select public.admin_year_reopen($1,'年度別再開',2025)",
      [U1],
    );
    assert.deepEqual(await snapshot(2026), currentBefore);
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from public.data_ballot where voter_id=$1 and year=2025",
          [U1],
        )
      ).rows[0].status,
      "draft",
    );
    await call(
      db,
      ADMIN,
      "select public.admin_year_thumbnail($1,'https://nicovideo.cdn.nimg.jp/thumbnails/12345/12345',2025)",
      [videos[0].video_id],
    );
    assert.deepEqual(await snapshot(2026), currentBefore);
    await assert.rejects(
      call(
        db,
        ADMIN,
        "select public.admin_year_profile($1,'1234567','共通ID訂正',2025)",
        [U1],
      ),
      /全年度共通/,
    );
    await call(
      db,
      ADMIN,
      "select public.admin_year_reopen($1,'共通ID訂正前の再開',2026)",
      [U1],
    );
    const corrected = await call(
      db,
      ADMIN,
      "select public.admin_year_profile($1,$2,'共通ID訂正',2025) r",
      [U1, voted.author_nico_user_id],
    );
    assert.ok((corrected.rows[0] as { r: { removed: number } }).r.removed > 0);
    assert.equal(
      (
        await db.query(
          "select e.id from public.data_ballots e join public.data_mad v using(year,video_id) join public.data_ballot b on b.id=e.ballot_id where b.source='site' and b.voter_id=$1 and v.author_nico_user_id=$2",
          [U1, voted.author_nico_user_id],
        )
      ).rows.length,
      0,
    );
    assert.deepEqual(await originals(), originalBefore);
    assert.equal(
      (
        await db.query<{ target_year: number }>(
          "select target_year from public.master_event_settings where id=1",
        )
      ).rows[0].target_year,
      2026,
    );
    assert.equal(
      (
        await db.query(
          "select id from public.audit_logs where action in ('import','reopen','thumbnail','profile_correction') and year=2025",
        )
      ).rows.length,
      5,
    );
    const security = await db.query<{
      name: string;
      definer: boolean;
      config: string[];
    }>(
      "select n.nspname||'.'||p.proname name,p.prosecdef definer,p.proconfig config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'admin_year_%'",
    );
    assert.ok(
      security.rows.every(
        (r) =>
          r.definer === r.name.startsWith("private.") &&
          r.config.includes('search_path=""'),
      ),
    );
  } finally {
    await db.close();
  }
});
