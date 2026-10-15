import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, minimum, U1, U2, ADMIN, OTHER } from "./database";

test("既存票を保持して3テーブルを改名し、新旧名のRLS・権限・RPCを維持", async () => {
  const { db, videos } = await database({
    beforeMigration: "rename_voting_data_tables",
  });
  try {
    for (const [uid, nico] of [
      [U1, "999999990"],
      [U2, "999999991"],
    ]) {
      await call(db, uid, "select public.save_profile($1,$2)", [
        "改名検証",
        nico,
      ]);
      await call(db, uid, "select public.save_draft($1,1)", [
        JSON.stringify(minimum(videos)),
      ]);
    }
    await call(db, U1, "select public.submit_ballot(2)");
    const pairs = [
      ["videos", "data_mad"],
      ["ballots", "data_ballot"],
      ["ballot_entries", "data_ballots"],
    ] as const;
    const before = await Promise.all(
      pairs.map(async ([old]) => ({
        rows: (await db.query(`select * from public.${old} order by 1`)).rows,
        metadata: (
          await db.query(
            `select oid,relacl,relrowsecurity,relowner from pg_class where oid='public.${old}'::regclass`,
          )
        ).rows,
      })),
    );
    const structuralSql = `select jsonb_build_object(
      'constraints',(select jsonb_agg(to_jsonb(c) order by oid) from pg_constraint c where connamespace='public'::regnamespace),
      'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace),
      'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),
      'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl,'owner',p.proowner,'definer',p.prosecdef,'config',p.proconfig) order by p.oid) from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace))
    ) as metadata`;
    const structure = (await db.query(structuralSql)).rows;
    const report = (
      await call(db, ADMIN, "select public.admin_report() as result")
    ).rows;
    const filename = (await readdir("supabase/migrations")).find((name) =>
      name.endsWith("_rename_voting_data_tables.sql"),
    )!;
    await db.exec(await readFile(`supabase/migrations/${filename}`, "utf8"));

    assert.deepEqual((await db.query(structuralSql)).rows, structure);
    assert.deepEqual(
      (await call(db, ADMIN, "select public.admin_report() as result")).rows,
      report,
    );
    for (let i = 0; i < pairs.length; i++) {
      const [old, current] = pairs[i];
      assert.deepEqual(
        (await db.query(`select * from public.${current} order by 1`)).rows,
        before[i].rows,
      );
      assert.deepEqual(
        (
          await db.query(
            `select oid,relacl,relrowsecurity,relowner from pg_class where oid='public.${current}'::regclass`,
          )
        ).rows,
        before[i].metadata,
      );
      const view = await db.query<{ relkind: string; reloptions: string[] }>(
        `select relkind,reloptions from pg_class where oid='public.${old}'::regclass`,
      );
      assert.equal(view.rows[0].relkind, "v");
      assert.ok(view.rows[0].reloptions.includes("security_invoker=true"));
      for (const uid of [U1, U2, ADMIN, OTHER]) {
        assert.deepEqual(
          (await call(db, uid, `select * from public.${old} order by 1`)).rows,
          (await call(db, uid, `select * from public.${current} order by 1`))
            .rows,
        );
      }
      for (const name of [old, current]) {
        await assert.rejects(
          call(db, null, `select * from public.${name}`, [], "anon"),
          /permission denied/,
        );
        assert.equal(
          (await call(db, OTHER, `select * from public.${name}`)).rows.length,
          0,
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
    assert.equal(
      (await call(db, U1, "select * from public.data_ballot")).rows.length,
      1,
    );
    assert.equal(
      (await call(db, U2, "select * from public.data_ballots")).rows.length,
      10,
    );
    assert.equal(
      (await call(db, ADMIN, "select * from public.data_ballots")).rows.length,
      20,
    );
    // Existing clients can still update thumbnails through the compatibility view.
    await call(
      db,
      null,
      "update public.videos set thumbnail_url=thumbnail_url where video_id=$1",
      [videos[0].video_id],
      "service_role",
    );
    // A draft created before the rename remains saveable and submittable afterwards.
    await call(db, U2, "select public.save_draft($1,2)", [
      JSON.stringify(minimum(videos)),
    ]);
    await call(db, U2, "select public.submit_ballot(3)");
    assert.equal(
      (
        (await call(db, U2, "select status from public.data_ballot"))
          .rows[0] as { status: string }
      ).status,
      "submitted",
    );
    const oldReferences = await db.query<{ n: number }>(
      `select count(*)::integer n from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) and prosrc ~ 'public[.](videos|ballots|ballot_entries)\\M'`,
    );
    assert.equal(oldReferences.rows[0].n, 0);
  } finally {
    await db.close();
  }
});
