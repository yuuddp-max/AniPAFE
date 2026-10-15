import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, U1, U2, ADMIN, OTHER } from "./database";

async function migrationSql() {
  const filename = (await readdir("supabase/migrations")).find((name) =>
    name.endsWith("_rename_profiles_to_data_profiles.sql"),
  )!;
  return readFile(`supabase/migrations/${filename}`, "utf8");
}

test("プロフィール改名で既存データ・RLS・権限を維持し、既存ユーザーの再保存・確定が動く", async () => {
  const { db, videos } = await database({
    beforeMigration: "rename_profiles_to_data_profiles",
  });
  try {
    for (const [uid, nico] of [
      [U1, "999999990"],
      [U2, "999999991"],
    ]) {
      await call(db, uid, "select public.save_profile($1,$2)", [
        "改名前",
        nico,
      ]);
      await call(db, uid, "select public.save_draft($1,1)", [
        JSON.stringify(minimum(videos)),
      ]);
    }
    await call(db, U1, "select public.submit_ballot(2)");
    const rows = (
      await db.query("select * from public.profiles order by user_id")
    ).rows;
    const metadataSql = `select jsonb_build_object(
      'table',(select jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl,'rls',relrowsecurity) from pg_class where oid=$1::regclass),
      'constraints',(select jsonb_agg(to_jsonb(c) order by oid) from pg_constraint c where conrelid=$1::regclass),
      'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=$1::regclass),
      'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=$1::regclass),
      'functions',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace))
    ) as metadata`;
    const before = (await db.query(metadataSql, ["public.profiles"])).rows;
    const report = (
      await call(db, ADMIN, "select public.admin_report() as report")
    ).rows;
    await db.exec(await migrationSql());
    assert.deepEqual(
      (await db.query("select * from public.data_profiles order by user_id"))
        .rows,
      rows,
    );
    assert.deepEqual(
      (await db.query(metadataSql, ["public.data_profiles"])).rows,
      before,
    );
    assert.deepEqual(
      (await call(db, ADMIN, "select public.admin_report() as report")).rows,
      report,
    );
    const view = await db.query<{ relkind: string; reloptions: string[] }>(
      "select relkind,reloptions from pg_class where oid='public.profiles'::regclass",
    );
    assert.equal(view.rows[0].relkind, "v");
    assert.ok(view.rows[0].reloptions.includes("security_invoker=true"));
    for (const name of ["profiles", "data_profiles"]) {
      for (const [uid, count] of [
        [U1, 1],
        [U2, 1],
        [ADMIN, 2],
        [OTHER, 0],
      ] as const)
        assert.equal(
          (await call(db, uid, `select * from public.${name}`)).rows.length,
          count,
        );
      await assert.rejects(
        call(db, null, `select * from public.${name}`, [], "anon"),
        /permission denied/,
      );
      await assert.rejects(
        call(
          db,
          U1,
          `update public.${name} set nico_user_id='123' where false`,
        ),
        /permission denied/,
      );
      await assert.rejects(
        call(db, U1, `delete from public.${name} where false`),
        /permission denied/,
      );
      assert.deepEqual(
        (
          await call(
            db,
            null,
            `select * from public.${name} order by user_id`,
            [],
            "service_role",
          )
        ).rows,
        rows,
      );
    }
    assert.deepEqual(
      (await call(db, U1, "select * from public.profiles")).rows,
      (await call(db, U1, "select * from public.data_profiles")).rows,
    );
    // Existing profile saves use ON CONFLICT against the physical table, never the view.
    await call(db, U2, "select public.save_profile($1,$2)", [
      "改名後の表示名",
      "999999991",
    ]);
    for (const name of ["profiles", "data_profiles"])
      assert.deepEqual(
        (await call(db, U2, `select display_name from public.${name}`)).rows,
        [{ display_name: "改名後の表示名" }],
      );
    await assert.rejects(
      call(db, U1, "select public.save_profile($1,$2)", [
        "確定済み",
        "999999992",
      ]),
      /確定後/,
    );
    await call(db, U2, "select public.save_draft($1,3)", [
      JSON.stringify(minimum(videos)),
    ]);
    await call(db, U2, "select public.submit_ballot(4)");
    await call(db, ADMIN, "select public.admin_reopen($1,$2)", [
      U2,
      "改名後の検証",
    ]);
    await call(db, ADMIN, "select public.admin_profile($1,$2,$3)", [
      U2,
      "999999993",
      "改名後の検証",
    ]);
    assert.equal(
      (
        await db.query<{ nico_user_id: string }>(
          "select nico_user_id from public.data_profiles where user_id=$1",
          [U2],
        )
      ).rows[0].nico_user_id,
      "999999993",
    );
    const references = await db.query<{ n: number }>(
      "select count(*)::integer n from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) and prosrc ~ 'public[.]profiles\\M'",
    );
    assert.equal(references.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("プロフィールの改名先が既にある場合は既存テーブルを変更せず停止", async () => {
  const { db } = await database({
    beforeMigration: "rename_profiles_to_data_profiles",
  });
  try {
    const before = (
      await db.query(
        "select oid,relkind from pg_class where oid='public.profiles'::regclass",
      )
    ).rows;
    await db.exec(
      "create view public.data_profiles as select user_id from public.profiles",
    );
    await assert.rejects(db.exec(await migrationSql()), /already exists/);
    await db.exec("rollback");
    assert.deepEqual(
      (
        await db.query(
          "select oid,relkind from pg_class where oid='public.profiles'::regclass",
        )
      ).rows,
      before,
    );
    assert.equal(
      (await db.query("select * from public.data_profiles")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
