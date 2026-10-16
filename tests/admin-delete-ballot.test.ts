import test from "node:test";
import assert from "node:assert/strict";
import { database, call, ADMIN, U1, U2, OTHER } from "./database";

test("投票削除：運営限定・年度/更新番号保護・原本/下書き/確定票・明細連鎖・監査・集計無効化", async () => {
  const { db, videos } = await database();
  try {
    await call(db, U1, "select public.save_profile('削除検証','350396')");
    await db.exec(`insert into public.master_poll_settings(id,year,title) values(2025,2025,'保持する年度');
      insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,watch_url,is_active)
        select 2025,video_id,display_order,title,author_nico_user_id,author_name,watch_url,is_active from public.data_mad where year=2026;
      delete from public.data_ballot;
      insert into public.data_ballot(year,voter_id,status,submitted_at) values
        (2025,'${U1}','submitted',now()),(2026,'${U1}','draft',null),(2026,'${U2}','submitted',now());
      insert into public.data_ballot(year,source,status,source_row,display_name,source_timestamp,raw_response)
        values(2026,'historical','imported',2,'削除する原本','元日時','{}');`);
    const targets = (
      await db.query<{
        id: string;
        year: number;
        revision: number;
        source: string;
      }>(
        "select id,year,revision,source from public.data_ballot order by year,id",
      )
    ).rows;
    for (const b of targets)
      await db.query(
        `insert into public.data_ballots(ballot_id,year,award_code,video_id,source,slot,source_video_number,source_video_label,selection_column,comment_column,comment)
       values($1,$2,'overall',$3,$4,case when $4='historical' then 1 end,case when $4='historical' then 1 end,case when $4='historical' then '作品1' end,case when $4='historical' then '選択' end,case when $4='historical' then '感想' end,'削除対象の感想')`,
        [b.id, b.year, videos[0].video_id, b.source],
      );
    const snapshot = async () =>
      (
        await db.query(`select jsonb_build_object(
      'profiles',(select jsonb_agg(p) from public.data_profiles p),
      'users',(select jsonb_agg(u) from auth.users u),
      'past',(select jsonb_agg(b) from public.data_ballot b where year=2025),
      'past_entries',(select jsonb_agg(e) from public.data_ballots e where year=2025),
      'settings',(select jsonb_agg(p) from public.master_poll_settings p),
      'target',(select jsonb_agg(t) from public.master_event_settings t)) s`)
      ).rows[0];
    const before = await snapshot();
    const first = targets.find((b) => b.year === 2026)!;
    const remove = (
      uid: string | null,
      id = first.id,
      rev = first.revision,
      year = 2026,
      reason = "誤登録の削除",
      role = "authenticated",
    ) =>
      call(
        db,
        uid,
        "select public.admin_year_delete_ballot($1,$2,$3,$4) r",
        [id, rev, reason, year],
        role,
      );
    for (const uid of [U1, U2, OTHER])
      await assert.rejects(remove(uid), /運営|権限|Google/);
    await assert.rejects(
      remove(null, first.id, first.revision, 2026, "理由", "anon"),
      /permission denied/,
    );
    await assert.rejects(
      remove(ADMIN, first.id, first.revision, 2025),
      /見つかりません/,
    );
    await assert.rejects(
      remove(ADMIN, first.id, first.revision + 1),
      /更新されました/,
    );
    await assert.rejects(
      remove(ADMIN, first.id, first.revision, 2026, " "),
      /削除理由/,
    );
    await assert.rejects(
      call(db, U1, "delete from public.data_ballot where id=$1", [first.id]),
      /permission denied/,
    );
    assert.equal(
      (await db.query("select * from public.data_ballot")).rows.length,
      4,
    );
    const revision = async () =>
      (
        await db.query<{ revision: number }>(
          "select revision from private.tally_input_revisions where year=2026",
        )
      ).rows[0].revision;
    const oldRevision = await revision();
    for (const b of targets.filter((b) => b.year === 2026)) {
      const r = await remove(ADMIN, b.id, b.revision);
      assert.deepEqual((r.rows[0] as { r: unknown }).r, {
        deleted_ballots: 1,
        deleted_entries: 1,
      });
      assert.equal(
        (
          await db.query(
            "select * from public.data_ballots where ballot_id=$1",
            [b.id],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(remove(ADMIN, b.id, b.revision), /見つかりません/);
    }
    assert.deepEqual(await snapshot(), before);
    assert.ok((await revision()) > oldRevision);
    const audits = (
      await db.query<{ summary: { reason: string; deleted_entries: number } }>(
        "select summary from public.audit_logs where action='delete_ballot'",
      )
    ).rows;
    assert.equal(audits.length, 3);
    for (const a of audits) {
      assert.equal(a.summary.reason, "誤登録の削除");
      assert.equal(a.summary.deleted_entries, 1);
    }
    assert.equal(
      (
        await call(
          db,
          U1,
          "select * from public.audit_logs where action='delete_ballot'",
        )
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
