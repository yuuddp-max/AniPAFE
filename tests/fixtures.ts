// Synthetic test records only; participant data is kept outside the public repository.
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { csv } from "../src/lib/validation";
import { parseImport } from "../src/lib/importer";
function syntheticVideos() {
  return Array.from({ length: 107 }, (_, index) => ({
    display_order: index + 1,
    video_id: `sm${90000001 + index}`,
    author_nico_user_id: index === 0 ? "350396" : String(200000 + index),
    author_name: `検証用投稿者 ${index + 1}`,
    title: `検証作品 ${index + 1}`,
    theme: index > 0 && index <= 55 ? `検証テーマ ${index}` : null,
    watch_url: `https://www.nicovideo.jp/watch/sm${90000001 + index}`,
    posted_at: "2026-08-31",
    is_active: true,
  }));
}
export async function fixtureCsv() {
  if (process.env.ANIPAFE_TEST_SYNTHETIC !== "1") {
    try {
      return await readFile("videos_seed.csv");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const rows = syntheticVideos();
  const keys = [
    "display_order",
    "video_id",
    "author_nico_user_id",
    "author_name",
    "title",
    "theme",
    "watch_url",
    "posted_at",
    "is_active",
  ] as const;
  return Buffer.from(
    csv([keys.slice(), ...rows.map((v) => keys.map((k) => v[k]))]),
  );
}
export async function fixtureWorkbook() {
  if (process.env.ANIPAFE_TEST_SYNTHETIC !== "1") {
    try {
      return await readFile("AniPAFE2026_アンケート用データ.xlsx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const source = await parseImport(await fixtureCsv(), "source.csv");
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("データ");
  sheet.addRow([
    "No",
    "ID",
    "削除",
    "投稿日",
    "ユーザーID",
    "ユーザー名",
    "作品名",
    "テーマ",
    "Link",
  ]);
  for (const v of source.videos)
    sheet.addRow([
      v.display_order,
      v.video_id,
      0,
      46265,
      v.author_nico_user_id,
      v.author_name,
      v.title,
      v.theme,
      v.watch_url,
    ]);
  for (let i = 0; i < 19; i++)
    sheet.addRow([
      108 + i,
      i < 2 ? `sm${91000001 + i}` : null,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  book
    .addWorksheet("XMLsample")
    .addRow(["これは投票対象に取り込まない検証用サンプル"]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function fixtureSeedSql() {
  if (process.env.ANIPAFE_TEST_SYNTHETIC !== "1") {
    try {
      return await readFile("supabase/seed.sql", "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const { videos } = await parseImport(await fixtureCsv(), "source.csv");
  return (
    "select public.bootstrap_import('" +
    JSON.stringify(videos).replaceAll("'", "''") +
    "'::jsonb,true);"
  );
}
