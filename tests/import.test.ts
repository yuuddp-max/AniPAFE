import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureCsv, fixtureWorkbook } from "./fixtures";
import { normalizeRows, parseImport } from "../src/lib/importer";
import {
  csvCell,
  normalizeNicoId,
  profileSchema,
  pollIsOpen,
} from "../src/lib/validation";
import { safeThumbnail } from "../src/lib/thumbnails";
test("Excel: 126行、削除19行、107作品、テーマ55、XMLsample除外、CSV完全一致", async () => {
  const x = await parseImport(await fixtureWorkbook(), "source.xlsx"),
    c = await parseImport(await fixtureCsv(), "source.csv");
  assert.equal(x.total, 126);
  assert.equal(x.excluded, 19);
  assert.equal(x.videos.length, 107);
  assert.equal(x.themed, 55);
  assert.deepEqual(x.errors, []);
  assert.deepEqual(x.videos, c.videos);
});
test("不正・欠損・重複・URL違いを除外し報告、空白テーマとExcel日付正規化", () => {
  const row = {
    display_order: 1,
    video_id: "sm123",
    author_nico_user_id: "000123",
    author_name: "name",
    title: "title",
    theme: "　 ",
    watch_url: "https://www.nicovideo.jp/watch/sm123",
    posted_at: 46265,
    is_active: true,
  };
  const r = normalizeRows([
    row,
    { ...row },
    { ...row, video_id: "bad" },
    { ...row, video_id: "sm999", watch_url: "https://evil.test" },
    { ...row, is_active: false },
  ]);
  assert.equal(r.videos.length, 1);
  assert.equal(r.errors.length, 3);
  assert.equal(r.excluded, 1);
  assert.equal(r.videos[0].theme, null);
  assert.equal(r.videos[0].author_nico_user_id, "123");
  assert.equal(r.videos[0].posted_at, "2026-08-31");
});
test("プロフィール、IDの先頭ゼロ、期間の境界、CSV数式注入、サムネイルURL制限", () => {
  assert.equal(normalizeNicoId(" 00012 "), "12");
  assert.equal(
    profileSchema.safeParse({ display_name: "　 ", nico_user_id: "1" }).success,
    false,
  );
  assert.equal(
    profileSchema.safeParse({ display_name: "a", nico_user_id: "１２" })
      .success,
    false,
  );
  const p = {
    is_published: true,
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: "2026-10-02T00:00:00Z",
  };
  assert.equal(pollIsOpen(p, Date.parse(p.starts_at)), true);
  assert.equal(pollIsOpen(p, Date.parse(p.ends_at)), false);
  assert.equal(pollIsOpen({ ...p, starts_at: null }), false);
  assert.equal(csvCell("=SUM(1,2)"), `"'=SUM(1,2)"`);
  assert.equal(csvCell(" \t+1"), `"' \t+1"`);
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(safeThumbnail("https://evil.test/a.jpg"), null);
  assert.equal(safeThumbnail("javascript:alert(1)"), null);
  assert.equal(safeThumbnail("https://tn.smilevideo.jp/smile?i=123"), null);
  assert.ok(safeThumbnail("https://nicovideo.cdn.nimg.jp/thumbnails/1/1"));
});
