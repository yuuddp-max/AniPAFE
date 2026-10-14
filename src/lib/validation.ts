import { z } from "zod";
export const normalizeNicoId = (value: string) =>
  value.trim().replace(/^0+(?=\d)/, "");
export const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "ユーザー名を入力してください。")
    .max(100),
  nico_user_id: z
    .string()
    .trim()
    .regex(/^[0-9]{1,30}$/, "ニコニコユーザーIDは半角数字で入力してください。")
    .transform(normalizeNicoId),
});
export const awardCodeSchema = z.enum([
  "overall",
  "music",
  "composition",
  "creative",
  "humor",
  "theme",
]);
export const entriesSchema = z
  .array(
    z.object({
      award_code: awardCodeSchema,
      video_id: z.string().regex(/^(sm|so|nm)[0-9]+$/),
      comment: z.string().max(1000),
    }),
  )
  .max(25);
export function pollIsOpen(
  poll: {
    is_published: boolean;
    starts_at: string | null;
    ends_at: string | null;
  },
  now = Date.now(),
) {
  return !!(
    poll.is_published &&
    poll.starts_at &&
    poll.ends_at &&
    now >= Date.parse(poll.starts_at) &&
    now < Date.parse(poll.ends_at)
  );
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  // Spreadsheet formula injection (including whitespace/control-prefixed formulas).
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csv(rows: unknown[][]) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
export function jst(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "未設定";
}
