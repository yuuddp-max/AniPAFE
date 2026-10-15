import ExcelJS from "exceljs";
import { tallyAwards, type TallyWork } from "./tally";
import type { AwardCode } from "./types";

function value(cell: ExcelJS.Cell): string | number | null {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) {
    return typeof v.result === "number" || typeof v.result === "string"
      ? v.result
      : null;
  }
  if (typeof v === "object" && "richText" in v)
    return v.richText.map((r) => r.text).join("");
  return null;
}
function durationSeconds(cell: ExcelJS.Cell): number | null {
  const raw = cell.value;
  // ExcelJS represents time-formatted numeric cells as UTC Dates.
  if (raw instanceof Date)
    return (
      raw.getUTCHours() * 3600 + raw.getUTCMinutes() * 60 + raw.getUTCSeconds()
    );
  const number = value(cell);
  return typeof number === "number" ? Math.round(number * 86400) : null;
}
export async function readTallyReference(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const sheet = wb.getWorksheet("動画データ");
  if (!sheet) throw new Error("参照Excelに「動画データ」シートがありません。");
  const works: TallyWork[] = [];
  const seen = new Set<number>();
  for (let i = 2; i <= sheet.rowCount; i++) {
    const n = Number(value(sheet.getCell(i, 1)));
    const title = value(sheet.getCell(i, 5));
    if (!Number.isInteger(n) || n < 1 || !title) continue;
    if (seen.has(n)) throw new Error("参照Excelの作品番号が重複しています。");
    seen.add(n);
    const id = String(value(sheet.getCell(i, 2)) ?? "");
    works.push({
      display_order: n,
      video_id: /^(sm|so|nm)\d+$/.test(id) ? id : null,
      title: String(title),
      author_name: String(value(sheet.getCell(i, 4)) ?? "未対応"),
      theme: String(value(sheet.getCell(i, 6)) ?? "") || null,
      collaboration: String(value(sheet.getCell(i, 8)) ?? "") || null,
      duration_seconds: durationSeconds(sheet.getCell(i, 7)),
      broadcast: {},
    });
  }
  const points: {
    award_code: AwardCode;
    display_order: number;
    points: number;
  }[] = [];
  const names = {
    overall: "6総合賞",
    music: "5選曲賞",
    composition: "4構成賞",
    humor: "3諧謔賞",
    creative: "2クリエイティブ賞",
    theme: "1テーマ",
  };
  for (const award of tallyAwards) {
    const sh = wb.getWorksheet(names[award.code]);
    if (!sh)
      throw new Error(
        `参照Excelに「${names[award.code]}」シートがありません。`,
      );
    const byNumber = new Map(works.map((w) => [w.display_order, w]));
    for (const work of works) work.broadcast![award.code] = false;
    for (let i = 2; i <= sh.rowCount; i++) {
      const n = Number(value(sh.getCell(i, 1))),
        pt = value(sh.getCell(i, 3));
      if (
        !Number.isInteger(n) ||
        n < 1 ||
        !value(sh.getCell(i, 2)) ||
        typeof pt !== "number"
      )
        continue;
      points.push({ award_code: award.code, display_order: n, points: pt });
      const work = byNumber.get(n);
      if (work)
        work.broadcast![award.code] =
          value(sh.getCell(i, award.code === "theme" ? 16 : 14)) === "○";
    }
  }
  return { works, points };
}
