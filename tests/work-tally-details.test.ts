import test from "node:test";
import assert from "node:assert/strict";
import { database, call, U1, ADMIN } from "./database";
import { tally } from "../src/lib/tally";

test("作品別明細：同名・動画IDなしの作品を番号で区別し、ページ・権限・競合を検証", async () => {
  const { db } = await database();
  try {
    const state = (
      await call(db, ADMIN, "select public.admin_tally_state(2026,'site') s")
    ).rows[0] as { s: { revision: string } };
    const details = Array.from({ length: 125 }, (_, i) => ({
      id: String(i),
      work_number: (i % 2) + 1,
      video_id: null,
      title: "同じ作品名",
      award_name: "総合賞",
      comment: "感想",
    }));
    const saved = (
      await call(
        db,
        ADMIN,
        "select public.admin_save_tally_result(2026,'site',143,4,$1,$2) s",
        [
          state.s.revision,
          JSON.stringify({
            ...tally({
              year: 2026,
              source: "site",
              ballotCount: 0,
              works: [],
              entries: [],
            }),
            details,
            detail_count: 125,
          }),
        ],
      )
    ).rows[0] as { s: string };
    const sql =
      "select public.admin_work_tally_details(2026,'site',143,4,$1,$2,'','',false,$3) s";
    const args = [saved.s, 0, 1];
    const first = (await call(db, ADMIN, sql, args)).rows[0] as {
      s: { total: number; details: { work_number: number }[] };
    };
    assert.equal(first.s.total, 63);
    assert.equal(first.s.details.length, 50);
    assert.ok(first.s.details.every((d) => d.work_number === 1));
    const last = (await call(db, ADMIN, sql, [saved.s, 1, 1])).rows[0] as {
      s: { details: unknown[] };
    };
    assert.equal(last.s.details.length, 13);
    const second = (await call(db, ADMIN, sql, [saved.s, 0, 2])).rows[0] as {
      s: { total: number };
    };
    assert.equal(second.s.total, 62);
    await assert.rejects(call(db, U1, sql, args));
    await assert.rejects(call(db, null, sql, args, "anon"));
    await assert.rejects(call(db, ADMIN, sql, [saved.s, 0, 0]));
    await db.exec(
      "update public.master_poll_settings set title=title where year=2026",
    );
    assert.equal(
      ((await call(db, ADMIN, sql, args)).rows[0] as { s: null }).s,
      null,
    );
  } finally {
    await db.close();
  }
});
