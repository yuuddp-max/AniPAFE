import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, U1, U2, ADMIN, OTHER } from "./database";
const boundary = "rename_award_types_to_master_award_types";
async function migrationSql() {
  const name = (await readdir("supabase/migrations")).find((name) =>
    name.endsWith(`_${boundary}.sql`),
  )!;
  return readFile(`supabase/migrations/${name}`, "utf8");
}

test("部門マスター改名で6部門・既存票・外部キー・RLS・集計と選択数ルールを保持", async () => {
  const { db, videos } = await database({ beforeMigration: boundary });
  try {
    for (const [uid, nico] of [
      [U1, "999999990"],
      [U2, "999999991"],
    ]) {
      await call(db, uid, "select public.save_profile($1,$2)", [
        "部門改名検証",
        nico,
      ]);
      await call(db, uid, "select public.save_draft($1,1)", [
        JSON.stringify(minimum(videos)),
      ]);
    }
    await call(db, U1, "select public.submit_ballot(2)");
    const awards = (
      await db.query("select * from public.award_types order by display_order")
    ).rows;
    const votes = (
      await db.query("select * from public.data_ballots order by id")
    ).rows;
    const metadataSql = `select jsonb_build_object(
      'table',(select jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl,'rls',relrowsecurity) from pg_class where oid=$1::regclass),
      'constraints',(select jsonb_agg(to_jsonb(c) order by oid) from pg_constraint c where conrelid=$1::regclass or confrelid=$1::regclass),
      'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=$1::regclass),
      'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=$1::regclass),
      'functions',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace))
    ) as metadata`;
    const before = (await db.query(metadataSql, ["public.award_types"])).rows;
    const report = (
      await call(db, ADMIN, "select public.admin_report() as report")
    ).rows;
    await db.exec(await migrationSql());
    assert.deepEqual(
      (await db.query(metadataSql, ["public.master_award_types"])).rows,
      before,
    );
    assert.deepEqual(
      (
        await db.query(
          "select * from public.master_award_types order by display_order",
        )
      ).rows,
      awards,
    );
    assert.deepEqual(
      (await db.query("select * from public.data_ballots order by id")).rows,
      votes,
    );
    assert.deepEqual(
      (await call(db, ADMIN, "select public.admin_report() as report")).rows,
      report,
    );
    const view = await db.query<{ relkind: string; reloptions: string[] }>(
      "select relkind,reloptions from pg_class where oid='public.award_types'::regclass",
    );
    assert.equal(view.rows[0].relkind, "v");
    assert.ok(view.rows[0].reloptions.includes("security_invoker=true"));
    for (const name of ["award_types", "master_award_types"]) {
      for (const uid of [U1, U2, ADMIN])
        assert.deepEqual(
          (
            await call(
              db,
              uid,
              `select * from public.${name} order by display_order`,
            )
          ).rows,
          awards,
        );
      assert.equal(
        (await call(db, OTHER, `select * from public.${name}`)).rows.length,
        0,
      );
      await assert.rejects(
        call(db, null, `select * from public.${name}`, [], "anon"),
        /permission denied/,
      );
      await assert.rejects(
        call(db, U1, `update public.${name} set min_votes=0 where false`),
        /permission denied/,
      );
      assert.deepEqual(
        (
          await call(
            db,
            null,
            `select * from public.${name} order by display_order`,
            [],
            "service_role",
          )
        ).rows,
        awards,
      );
    }
    await assert.rejects(
      db.query(
        "insert into public.data_ballots(ballot_id,award_code,video_id) select id,'unknown_award',$1 from public.data_ballot where voter_id=$2",
        [videos[0].video_id, U2],
      ),
      /foreign key constraint/,
    );
    const valid = minimum(videos);
    const under = valid.filter((_, index) => index !== 0);
    await call(db, U2, "select public.save_draft($1,2)", [
      JSON.stringify(under),
    ]);
    await assert.rejects(
      call(db, U2, "select public.submit_ballot(3)"),
      /総合賞/,
    );
    await call(db, U2, "select public.save_draft($1,3)", [
      JSON.stringify(valid),
    ]);
    await call(db, U2, "select public.submit_ballot(4)");
    assert.deepEqual(
      (
        await call(
          db,
          ADMIN,
          "select sum((x->>'votes')::integer)::integer n from jsonb_array_elements(public.admin_report()->'rankings') x",
        )
      ).rows,
      [{ n: 20 }],
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::integer n from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) and prosrc ~ 'public[.]award_types\\M'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("部門マスターの改名先が既存なら元のテーブルと外部キーを変更せず停止", async () => {
  const { db } = await database({ beforeMigration: boundary });
  try {
    const query =
      "select oid,relkind from pg_class where oid='public.award_types'::regclass";
    const before = (await db.query(query)).rows;
    await db.exec(
      "create view public.master_award_types as select * from public.award_types",
    );
    await assert.rejects(db.exec(await migrationSql()), /already exists/);
    await db.exec("rollback");
    assert.deepEqual((await db.query(query)).rows, before);
    assert.equal(
      (await db.query("select * from public.award_types")).rows.length,
      6,
    );
  } finally {
    await db.close();
  }
});
