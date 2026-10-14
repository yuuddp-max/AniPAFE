import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { normalizeNicoId } from "./validation";
import type { Video } from "./types";
type Row = Record<string, unknown>;
export type ImportReport = {
  videos: Omit<Video, "thumbnail_url">[];
  excluded: number;
  errors: { row: number; reason: string }[];
  total: number;
  themed: number;
};
const text = (v: unknown) => (v == null ? "" : String(v).trim());
function date(value: unknown) {
  if (!value || value === "#VALUE!") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number")
    return new Date(Math.round((value - 25569) * 86400000))
      .toISOString()
      .slice(0, 10);
  const s = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw new Error("投稿日が不正です");
  return s;
}
export function normalizeRows(rows: Row[], excel = false): ImportReport {
  const report: ImportReport = {
    videos: [],
    excluded: 0,
    errors: [],
    total: rows.length,
    themed: 0,
  };
  const ids = new Set<string>();
  rows.forEach((row, i) => {
    if (
      excel
        ? text(row["削除"]) !== "0"
        : !["true", "1"].includes(text(row.is_active).toLowerCase())
    ) {
      report.excluded++;
      return;
    }
    try {
      const get = (a: string, b: string) => row[excel ? a : b];
      const id = text(get("ID", "video_id"));
      if (!/^(sm|so|nm)\d+$/.test(id)) throw new Error("動画IDが不正です");
      if (ids.has(id)) throw new Error("動画IDが重複しています");
      const author = text(get("ユーザーID", "author_nico_user_id"));
      if (!/^\d{1,30}$/.test(author)) throw new Error("投稿者IDが不正です");
      const title = text(get("作品名", "title")),
        name = text(get("ユーザー名", "author_name"));
      if (
        !title ||
        title === "#VALUE!" ||
        !name ||
        name === "#VALUE!" ||
        title.length > 500 ||
        name.length > 100
      )
        throw new Error("タイトル・投稿者名が不正です");
      const order = Number(get("No", "display_order"));
      if (!Number.isInteger(order) || order < 1)
        throw new Error("表示順が不正です");
      const url = text(get("Link", "watch_url"));
      if (url !== `https://www.nicovideo.jp/watch/${id}`)
        throw new Error("動画URLとIDが一致しません");
      const theme = text(get("テーマ", "theme")) || null;
      if (theme === "#VALUE!" || (theme?.length ?? 0) > 500)
        throw new Error("テーマが不正です");
      report.videos.push({
        video_id: id,
        display_order: order,
        title,
        author_nico_user_id: normalizeNicoId(author),
        author_name: name,
        theme,
        watch_url: url,
        posted_at: date(get("投稿日", "posted_at")),
        is_active: true,
      });
      ids.add(id);
    } catch (e) {
      report.errors.push({ row: i + 2, reason: (e as Error).message });
    }
  });
  report.themed = report.videos.filter((v) => v.theme).length;
  return report;
}
export async function parseImport(buffer: Buffer, filename: string) {
  if (buffer.length > 2 * 1024 * 1024)
    throw new Error("ファイルは2MB以下にしてください。");
  if (filename.toLowerCase().endsWith(".csv"))
    return normalizeRows(
      parse(buffer, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        max_record_size: 20000,
      }),
    );
  if (!filename.toLowerCase().endsWith(".xlsx"))
    throw new Error("CSVまたはXLSXを指定してください。");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    buffer as unknown as Parameters<typeof book.xlsx.load>[0],
  );
  const sheet = book.getWorksheet("データ");
  if (!sheet || sheet.rowCount > 2000)
    throw new Error("データシートがないか、行数が上限を超えています。");
  const headers = sheet.getRow(1).values as unknown[];
  const rows: Row[] = [];
  sheet.eachRow((r, index) => {
    if (index === 1) return;
    const row: Row = {};
    headers.forEach((h, col) => {
      if (col && h) {
        const v = r.getCell(col).value;
        row[text(h)] =
          v && typeof v === "object" && "formula" in v ? v.result : v;
      }
    });
    rows.push(row);
  });
  return normalizeRows(rows, true);
}
