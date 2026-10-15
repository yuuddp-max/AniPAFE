import test from "node:test";
import assert from "node:assert/strict";
import { database, call, minimum, U1, U2, ADMIN } from "./database";
import type { Ranking } from "../src/lib/types";

test("DB集計：同年度の確定投票だけで総合1点、複数作品・再確定・権限を検証", async () => {
  const { db, videos } = await database();
  try {
    await call(db, U1, "select public.save_profile('投稿者','000350396')");
    await call(db, U2, "select public.save_profile('下書きの投稿者',$1)", [
      videos[2].author_nico_user_id,
    ]);
    // A second work by the same author also receives exactly one bonus.
    await db.query(
      "update public.data_mad set author_nico_user_id='350396' where video_id=$1",
      [videos[1].video_id],
    );
    await db.exec(`insert into public.data_ballot(year,source,status,source_row,display_name,source_timestamp,nico_user_id,raw_response)
      values(2026,'historical','imported',2,'原本投稿者','元日時','${videos[2].author_nico_user_id}','{}')`);
    await db.exec(`insert into public.master_poll_settings(id,year,title) values(2025,2025,'別年度');
      insert into public.data_ballot(year,voter_id,status,submitted_at) values(2025,'${U2}','submitted',now())`);
    const rankings = async () =>
      (await db.query<{ r: Ranking[] }>("select private.year_rankings(2026) r"))
        .rows[0].r;
    assert.ok((await rankings()).every((r) => r.creator_bonus === 0));
    const choices = minimum(
      videos.map((v, i) =>
        i === 1 ? { ...v, author_nico_user_id: "350396" } : v,
      ),
    );
    await call(db, U1, "select public.save_draft($1,1,2026)", [
      JSON.stringify(choices),
    ]);
    assert.ok((await rankings()).every((r) => r.creator_bonus === 0));
    await call(db, U1, "select public.submit_ballot(2,2026)");
    const rows = await rankings();
    for (const video of videos.slice(0, 2)) {
      const own = rows.find(
        (r) => r.video_id === video.video_id && r.award_code === "overall",
      )!;
      assert.equal(own.votes, 0);
      assert.equal(own.creator_bonus, 1);
      assert.equal(own.points, 1);
    }
    assert.ok(
      rows
        .filter((r) => r.award_code !== "overall")
        .every((r) => r.creator_bonus === 0 && r.points === r.votes),
    );
    assert.equal(
      rows.find(
        (r) => r.video_id === videos[2].video_id && r.award_code === "overall",
      )!.creator_bonus,
      0,
    );
    await call(db, U1, "select public.submit_ballot(2,2026)");
    assert.deepEqual(await rankings(), rows);
    for (const uid of [U1, ADMIN])
      await assert.rejects(
        call(db, uid, "select private.year_rankings(2026)"),
        /permission/,
      );
    assert.ok(!JSON.stringify(rows).includes("nico_user_id"));
    // Reopening removes the bonus until voting is finalized again.
    await call(db, ADMIN, "select public.admin_reopen($1,'修正テスト',2026)", [
      U1,
    ]);
    assert.ok((await rankings()).every((r) => r.creator_bonus === 0));
  } finally {
    await db.close();
  }
});
