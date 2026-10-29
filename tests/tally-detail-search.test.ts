import test from "node:test";
import assert from "node:assert/strict";
import { database, call, U1, ADMIN } from "./database";
import { tally } from "../src/lib/tally";

test("明細検索：全ページ・文字正規化・空白感想・権限・古い集計を検証", async () => {
  const { db } = await database();
  try {
    const state = (
      await call(db, ADMIN, "select public.admin_tally_state(2026,'site') s")
    ).rows[0] as { s: { revision: string } };
    const details = Array.from({ length: 125 }, (_, i) => ({
      id: String(i),
      title: i === 124 ? "Ｂｌｕｅ 最後の作品" : "作品",
      display_name: "回答者",
      award_name: i % 2 ? "選曲賞" : "総合賞",
      comment: i % 3 ? " \n　" : "感想 %_",
      nico_user_id: "123",
    }));
    const saved = (
      await call(
        db,
        ADMIN,
        "select public.admin_save_tally_result(2026,'site',143,3,$1,$2) s",
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
      "select public.admin_search_tally_details(2026,'site',143,3,$1,$2,$3,$4,$5) s";
    const search = async (page = 0, q = "", award = "", comments = false) =>
      (await call(db, ADMIN, sql, [saved.s, page, q, award, comments]))
        .rows[0] as { s: { total: number; details: { id: string }[] } | null };
    assert.equal((await search(0, "blue")).s?.details[0].id, "124");
    assert.equal((await search(0, "不存在")).s?.total, 0);
    assert.equal((await search(0, "%_")).s?.total, 42);
    assert.equal((await search(0, "", "", true)).s?.total, 42);
    assert.equal((await search(0, "", "選曲賞", true)).s?.total, 21);
    assert.equal((await search(0)).s?.details.length, 50);
    assert.equal((await search(2)).s?.details.length, 25);
    assert.equal((await search(3)).s?.details.length, 0);
    await assert.rejects(call(db, U1, sql, [saved.s, 0, "作品", "", false]));
    await assert.rejects(
      call(db, null, sql, [saved.s, 0, "作品", "", false], "anon"),
    );
    await assert.rejects(search(-1));
    await assert.rejects(search(0, "x".repeat(201)));
    await db.exec(
      "update public.master_poll_settings set title=title where year=2026",
    );
    assert.equal((await search(0, "作品")).s, null);
  } finally {
    await db.close();
  }
});
