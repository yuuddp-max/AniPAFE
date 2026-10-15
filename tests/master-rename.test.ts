import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, U1, U2, ADMIN, OTHER } from "./database";

const boundary = "rename_settings_and_admin_master_tables";
async function migrationSql() {
  const filename = (await readdir("supabase/migrations")).find((name) =>
    name.endsWith(`_${boundary}.sql`),
  )!;
  return readFile(`supabase/migrations/${filename}`, "utf8");
}
test("マスター改名で設定と管理者を保持し、新旧名の認可・受付ON/OFF・保存確定が動く", async () => {
  const { db, videos } = await database({ beforeMigration: boundary });
  try {
    await db.query("insert into public.admin_users values ($1),($2)", [
      U2,
      OTHER,
    ]);
    await call(db, U1, "select public.save_profile($1,$2)", [
      "一般投票者",
      "999999990",
    ]);
    await call(db, U1, "select public.save_draft($1,1)", [
      JSON.stringify(minimum(videos)),
    ]);
    const pairs = [
      ["poll_settings", "master_poll_settings"],
      ["admin_users", "master_admin_users"],
    ] as const;
    const metadataSql = `select jsonb_build_object(
      'table',(select jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl,'rls',relrowsecurity) from pg_class where oid=$1::regclass),
      'constraints',(select jsonb_agg(to_jsonb(c) order by oid) from pg_constraint c where conrelid=$1::regclass),
      'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=$1::regclass),
      'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=$1::regclass),
      'functions',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace))
    ) as metadata`;
    const before = await Promise.all(
      pairs.map(async ([old]) => ({
        rows: (await db.query(`select * from public.${old} order by 1`)).rows,
        metadata: (await db.query(metadataSql, [`public.${old}`])).rows,
      })),
    );
    const report = (
      await call(db, ADMIN, "select public.admin_report() as report")
    ).rows;
    await db.exec(await migrationSql());
    for (let i = 0; i < pairs.length; i++) {
      const [old, current] = pairs[i];
      assert.deepEqual(
        (await db.query(`select * from public.${current} order by 1`)).rows,
        before[i].rows,
      );
      assert.deepEqual(
        (await db.query(metadataSql, [`public.${current}`])).rows,
        before[i].metadata,
      );
      const view = await db.query<{ relkind: string; reloptions: string[] }>(
        `select relkind,reloptions from pg_class where oid='public.${old}'::regclass`,
      );
      assert.equal(view.rows[0].relkind, "v");
      assert.ok(view.rows[0].reloptions.includes("security_invoker=true"));
      for (const uid of [U1, U2, ADMIN, OTHER])
        assert.deepEqual(
          (await call(db, uid, `select * from public.${old} order by 1`)).rows,
          (await call(db, uid, `select * from public.${current} order by 1`))
            .rows,
        );
      for (const name of [old, current]) {
        await assert.rejects(
          call(db, null, `select * from public.${name}`, [], "anon"),
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
              `select * from public.${name} order by 1`,
              [],
              "service_role",
            )
          ).rows,
          before[i].rows,
        );
      }
    }
    assert.deepEqual(
      (await call(db, ADMIN, "select public.admin_report() as report")).rows,
      report,
    );
    assert.equal(
      (await call(db, U1, "select * from public.master_admin_users")).rows
        .length,
      0,
    );
    assert.equal(
      (await call(db, ADMIN, "select * from public.master_admin_users")).rows
        .length,
      1,
    );
    assert.equal(
      (await call(db, U2, "select * from public.master_admin_users")).rows
        .length,
      1,
    );
    assert.equal(
      (await call(db, OTHER, "select * from public.master_admin_users")).rows
        .length,
      0,
    );
    assert.equal(
      (await call(db, OTHER, "select * from public.master_poll_settings")).rows
        .length,
      0,
    );
    await assert.rejects(
      call(db, U1, "select public.admin_report()"),
      /運営者/,
    );
    await assert.rejects(
      call(db, OTHER, "select public.admin_report()"),
      /運営者/,
    );
    await assert.rejects(
      call(db, U1, `insert into public.master_admin_users values ('${U1}')`),
      /permission denied/,
    );
    await assert.rejects(
      call(
        db,
        U1,
        "select public.admin_settings(now()-interval '1 day',now()+interval '1 day',false)",
      ),
      /運営者/,
    );
    await call(
      db,
      ADMIN,
      "select public.admin_settings(now()-interval '1 day',now()+interval '1 day',false)",
    );
    await assert.rejects(
      call(db, U1, "select public.save_draft($1,2)", [
        JSON.stringify(minimum(videos)),
      ]),
      /期間外/,
    );
    await call(
      db,
      ADMIN,
      "select public.admin_settings(now()-interval '1 day',now()+interval '1 day',true)",
    );
    await call(db, U1, "select public.save_draft($1,2)", [
      JSON.stringify(minimum(videos)),
    ]);
    await call(db, U1, "select public.submit_ballot(3)");
    const refs = await db.query<{ n: number }>(
      "select count(*)::integer n from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) and prosrc ~ 'public[.](poll_settings|admin_users)\\M'",
    );
    assert.equal(refs.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("マスター改名先が既存の場合は2テーブルとも変更せず中止", async () => {
  const { db } = await database({ beforeMigration: boundary });
  try {
    const query =
      "select oid,relname,relkind from pg_class where oid in ('public.poll_settings'::regclass,'public.admin_users'::regclass) order by oid";
    const before = (await db.query(query)).rows;
    await db.exec(
      "create view public.master_admin_users as select * from public.admin_users",
    );
    await assert.rejects(db.exec(await migrationSql()), /already exists/);
    await db.exec("rollback");
    assert.deepEqual((await db.query(query)).rows, before);
    assert.equal(
      (
        await db.query<{ target: string | null }>(
          "select to_regclass('public.master_poll_settings')::text as target",
        )
      ).rows[0].target,
      null,
    );
  } finally {
    await db.close();
  }
});
