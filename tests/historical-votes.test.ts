import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { database, call, ADMIN, U1, OTHER } from "./database";

test("過去投票は元データを保持し、管理者限定・年度分離・現行票との分離を強制する", async () => {
  const { db, videos } = await database({
    beforeMigration: "historical_vote_import",
  });
  try {
    const snapshot = async () =>
      (
        await db.query(`select jsonb_build_object(
      'videos',(select jsonb_agg(to_jsonb(v) order by year,video_id) from public.data_mad v),
      'settings',(select jsonb_agg(to_jsonb(p) order by year) from public.master_poll_settings p),
      'ballots',(select jsonb_agg(to_jsonb(b) order by id) from public.data_ballot b),
      'entries',(select jsonb_agg(to_jsonb(e) order by id) from public.data_ballots e),
      'event',(select to_jsonb(e) from public.master_event_settings e where id=1)
    ) snapshot`)
      ).rows[0];
    const before = await snapshot();
    const file = (await readdir("supabase/migrations")).find((n) =>
      n.endsWith("_historical_vote_import.sql"),
    )!;
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    assert.deepEqual(await snapshot(), before);
    await db.exec(
      "insert into public.master_poll_settings(id,year,title) values(2025,2025,'過去投票')",
    );
    const batch = (
      await db.query<{ id: string }>(`insert into public.data_historical_imports
      (year,source_filename,source_sha256,source_sheet,column_mapping,expected_ballots,expected_entries,expected_votes,expected_comments,report)
      values(2025,'fixture.xlsx',repeat('a',64),'2025','{}',1,3,2,3,'{}') returning id`)
    ).rows[0].id;
    const ballot = (
      await db.query<{ id: string }>(
        `insert into public.data_historical_ballot
      (import_id,year,source_row,display_name,nico_user_id,created_at,source_timestamp,raw_response)
      values($1,2025,2,'過去の回答者',null,'2025-10-01T14:42:45Z','2025/10/01 11:42:45 午後 GMT+9','{"元列":"原文"}') returning id`,
        [batch],
      )
    ).rows[0].id;
    const video = videos[0].video_id;
    await db.query(
      `insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,watch_url,is_active)
      select 2025,video_id,display_order,title,author_nico_user_id,author_name,watch_url,is_active from public.data_mad where year=2026 and video_id=$1`,
      [video],
    );
    await db.query(
      `insert into public.data_historical_ballots
      (ballot_id,year,award_code,slot,source_video_number,source_video_label,video_id,comment,selection_column,comment_column) values
      ($1,2025,'overall',1,1,'001 元作品ラベル',$2,$3,'（1/10）','感想_01'),
      ($1,2025,'humor',1,72,'072 削除済み作品',null,'削除済み作品への感想','諧謔賞（1/3）','感想_51'),
      ($1,2025,'creative',1,null,null,null,'選択なしの感想','クリエイティブ賞（1/3）','感想_41')`,
      [ballot, video, "あ".repeat(1073)],
    );
    const saved = (
      await db.query<{
        n: number;
        votes: number;
        max_comment: number;
      }>(`select count(*)::int n,
      count(source_video_number)::int votes,max(char_length(comment))::int max_comment from public.data_historical_ballots`)
    ).rows[0];
    assert.deepEqual(saved, { n: 3, votes: 2, max_comment: 1073 });
    assert.equal(
      (
        await db.query<{ nico_user_id: string | null }>(
          "select nico_user_id from public.data_historical_ballot",
        )
      ).rows[0].nico_user_id,
      null,
    );
    for (const table of [
      "data_historical_imports",
      "data_historical_ballot",
      "data_historical_ballots",
    ]) {
      assert.equal(
        (await call(db, ADMIN, `select * from public.${table}`)).rows.length,
        table === "data_historical_ballots" ? 3 : 1,
      );
      assert.equal(
        (await call(db, U1, `select * from public.${table}`)).rows.length,
        0,
      );
      assert.equal(
        (await call(db, OTHER, `select * from public.${table}`)).rows.length,
        0,
      );
      await assert.rejects(
        call(db, null, `select * from public.${table}`, [], "anon"),
        /permission denied/,
      );
      await assert.rejects(
        call(db, ADMIN, `delete from public.${table}`),
        /permission denied/,
      );
    }
    await db.query("insert into public.master_admin_users values($1)", [OTHER]);
    assert.equal(
      (await call(db, OTHER, "select * from public.data_historical_ballot"))
        .rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        `insert into public.data_historical_ballot
      (import_id,year,source_row,display_name,created_at,source_timestamp,raw_response)
      values($1,2026,3,'年度不一致',now(),'raw','{}')`,
        [batch],
      ),
      /foreign key/,
    );
    await assert.rejects(
      db.query(
        `insert into public.data_historical_ballots
      (ballot_id,year,award_code,slot,source_video_number,source_video_label,selection_column,comment_column)
      values($1,2026,'overall',2,1,'001 元作品','x','y')`,
        [ballot],
      ),
      /foreign key/,
    );
    await assert.rejects(
      db.query(
        `insert into public.data_historical_ballots
      (ballot_id,year,award_code,slot,source_video_number,source_video_label,selection_column,comment_column)
      values($1,2025,'overall',1,1,'001 元作品','x','y')`,
        [ballot],
      ),
      /duplicate key/,
    );
    await assert.rejects(
      db.query(`insert into public.data_historical_imports
      (year,source_filename,source_sha256,source_sheet,column_mapping,expected_ballots,expected_entries,expected_votes,expected_comments,report)
      values(2025,'same-file.xlsx',repeat('a',64),'2025','{}',1,3,2,3,'{}')`),
      /duplicate key/,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.data_ballot where year=2025",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from auth.users"))
        .rows[0].n,
      4,
    );
    assert.equal(
      (
        await db.query<{ target_year: number }>(
          "select target_year from public.master_event_settings",
        )
      ).rows[0].target_year,
      2026,
    );
    const indexMigration = (await readdir("supabase/migrations")).find((n) =>
      n.endsWith("_historical_vote_import_indexes.sql"),
    )!;
    await db.exec(
      await readFile(`supabase/migrations/${indexMigration}`, "utf8"),
    );
    const historySnapshot = async () =>
      (
        await db.query(`select jsonb_build_object(
        'imports',(select jsonb_agg(to_jsonb(t)-'imported_at' order by id) from public.data_historical_imports t),
        'ballots',(select jsonb_agg(to_jsonb(t)-'import_id'-'imported_at' order by id) from public.data_historical_ballot t),
        'entries',(select jsonb_agg(to_jsonb(t)-'imported_at' order by id) from public.data_historical_ballots t)
      ) snapshot`)
      ).rows[0];
    const historicalBeforeRemoval = await historySnapshot();
    const liveBeforeRemoval = await snapshot();
    const removeMigration = (await readdir("supabase/migrations")).find((n) =>
      n.endsWith("_remove_historical_import_metadata.sql"),
    )!;
    await db.exec(
      await readFile(`supabase/migrations/${removeMigration}`, "utf8"),
    );
    assert.deepEqual(await historySnapshot(), historicalBeforeRemoval);
    assert.deepEqual(await snapshot(), liveBeforeRemoval);
    assert.equal(
      (
        await db.query<{ n: number }>(`select count(*)::int n
      from information_schema.columns where table_schema='public'
      and table_name like 'data_historical%' and column_name in ('import_id','imported_at')`)
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      db.query(`insert into public.data_historical_ballot
      (year,source_row,display_name,created_at,source_timestamp,raw_response)
      values(2098,2,'未登録年度',now(),'raw','{}')`),
      /foreign key/,
    );
    assert.equal(
      (await call(db, ADMIN, "select * from public.data_historical_ballots"))
        .rows.length,
      3,
    );
    assert.equal(
      (await call(db, U1, "select * from public.data_historical_ballots")).rows
        .length,
      0,
    );
    await assert.rejects(
      call(
        db,
        null,
        "select * from public.data_historical_ballots",
        [],
        "anon",
      ),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
