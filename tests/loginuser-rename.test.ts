import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, U1, U2, ADMIN, OTHER } from "./database";

async function migration() {
  const file = (await readdir("supabase/migrations")).find((file) =>
    file.endsWith("_rename_data_profiles_to_data_loginuser.sql"),
  )!;
  return readFile(`supabase/migrations/${file}`, "utf8");
}

test("ログインユーザー改名：全データ保持・旧名RLS互換・保存/投票/運営RPC・年度別キャッシュ無効化", async () => {
  const { db, videos } = await database({
    beforeMigration: "rename_data_profiles_to_data_loginuser",
  });
  try {
    for (const [uid, id] of [
      [U1, "999999990"],
      [U2, "999999991"],
    ]) {
      await call(db, uid, "select public.save_profile($1,$2)", ["改名前", id]);
      await call(db, uid, "select public.save_draft($1,1,2026)", [
        JSON.stringify(minimum(videos)),
      ]);
    }
    await call(db, U1, "select public.submit_ballot(2,2026)");
    await db.exec(`insert into public.master_poll_settings(id,year,title) values(2025,2025,'別年度を保持');
      insert into public.data_ballot(year,voter_id) values(2025,'${U2}');
      insert into public.data_ballot(year,source,status,source_row,display_name,source_timestamp,raw_response)
        values(2025,'historical','imported',2,'原本回答者','元日時','{"original":"保持"}');`);
    const snapshot = async (table: string) =>
      (
        await db.query(`select jsonb_build_object(
      'users',(select jsonb_agg(p order by user_id) from public.${table} p),
      'works',(select jsonb_agg(v order by year,video_id) from public.data_mad v),
      'ballots',(select jsonb_agg(b order by id) from public.data_ballot b),
      'entries',(select jsonb_agg(e order by id) from public.data_ballots e),
      'settings',(select jsonb_agg(s order by year) from public.master_poll_settings s),
      'target',(select jsonb_agg(t) from public.master_event_settings t),
      'audit',(select jsonb_agg(a order by id) from public.audit_logs a),
      'revisions',(select jsonb_agg(r order by year) from private.tally_input_revisions r)) s`)
      ).rows;
    const before = await snapshot("data_profiles");
    const metadata = async (table: string) =>
      (
        await db.query(
          `select oid,relowner,relacl,relrowsecurity from pg_class where oid=$1::regclass`,
          [`public.${table}`],
        )
      ).rows;
    const originalMetadata = await metadata("data_profiles");
    const report = (await call(db, ADMIN, "select public.admin_report() r"))
      .rows;
    await db.exec(await migration());
    assert.deepEqual(await snapshot("data_loginuser"), before);
    assert.deepEqual(await metadata("data_loginuser"), originalMetadata);
    assert.deepEqual(
      (await call(db, ADMIN, "select public.admin_report() r")).rows,
      report,
    );
    assert.equal(
      (
        await db.query<{ relkind: string }>(
          "select relkind from pg_class where oid='public.data_loginuser'::regclass",
        )
      ).rows[0].relkind,
      "r",
    );
    const oldView = (
      await db.query<{ relkind: string; reloptions: string[] }>(
        "select relkind,reloptions from pg_class where oid='public.data_profiles'::regclass",
      )
    ).rows[0];
    assert.equal(oldView.relkind, "v");
    assert.ok(oldView.reloptions.includes("security_invoker=true"));
    for (const table of ["data_loginuser", "data_profiles", "profiles"]) {
      for (const [uid, count] of [
        [U1, 1],
        [U2, 1],
        [ADMIN, 2],
        [OTHER, 0],
      ] as const)
        assert.equal(
          (await call(db, uid, `select * from public.${table}`)).rows.length,
          count,
        );
      await assert.rejects(
        call(db, null, `select * from public.${table}`, [], "anon"),
        /permission denied/,
      );
      await assert.rejects(
        call(
          db,
          U1,
          `update public.${table} set display_name='不正' where false`,
        ),
        /permission denied/,
      );
      await assert.rejects(
        call(db, U1, `delete from public.${table} where false`),
        /permission denied/,
      );
      assert.equal(
        (
          await call(
            db,
            null,
            `select * from public.${table}`,
            [],
            "service_role",
          )
        ).rows.length,
        2,
      );
    }
    const revisions = async () =>
      (
        await db.query<{ year: number; revision: number }>(
          "select year,revision from private.tally_input_revisions order by year",
        )
      ).rows;
    const oldRevisions = await revisions();
    await call(db, U2, "select public.save_profile($1,$2)", [
      "改名後の再保存",
      "999999991",
    ]);
    for (const r of await revisions())
      assert.ok(
        r.revision > oldRevisions.find((old) => old.year === r.year)!.revision,
      );
    for (const table of ["data_loginuser", "data_profiles", "profiles"])
      assert.deepEqual(
        (await call(db, U2, `select display_name from public.${table}`)).rows,
        [{ display_name: "改名後の再保存" }],
      );
    const revision = (
      await db.query<{ revision: number }>(
        "select revision from public.data_ballot where year=2026 and voter_id=$1",
        [U2],
      )
    ).rows[0].revision;
    await call(db, U2, "select public.save_draft($1,$2,2026)", [
      JSON.stringify(minimum(videos)),
      revision,
    ]);
    await call(db, U2, "select public.submit_ballot($1,2026)", [revision + 1]);
    await call(
      db,
      ADMIN,
      "select public.admin_year_reopen($1,'改名後検証',2026)",
      [U2],
    );
    await call(
      db,
      ADMIN,
      "select public.admin_year_profile($1,'999999992','改名後検証',2026)",
      [U2],
    );
    assert.equal(
      (
        await db.query<{ nico_user_id: string }>(
          "select nico_user_id from public.data_loginuser where user_id=$1",
          [U2],
        )
      ).rows[0].nico_user_id,
      "999999992",
    );
    await assert.rejects(
      call(db, U1, "select public.save_profile('確定票保持','999999993')"),
      /確定後/,
    );
    const refs = (
      await db.query<{ n: number }>(
        "select count(*)::integer n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and p.prosrc like '%data_profiles%'",
      )
    ).rows[0].n;
    assert.equal(refs, 0);
  } finally {
    await db.close();
  }
});

test("ログインユーザー改名：改名先が存在する場合は変更せず停止", async () => {
  const { db } = await database({
    beforeMigration: "rename_data_profiles_to_data_loginuser",
  });
  try {
    const before = (
      await db.query(
        "select oid,relkind from pg_class where oid='public.data_profiles'::regclass",
      )
    ).rows;
    await db.exec(
      "create view public.data_loginuser as select user_id from public.data_profiles",
    );
    await assert.rejects(db.exec(await migration()), /already exists/);
    await db.exec("rollback");
    assert.deepEqual(
      (
        await db.query(
          "select oid,relkind from pg_class where oid='public.data_profiles'::regclass",
        )
      ).rows,
      before,
    );
  } finally {
    await db.close();
  }
});
