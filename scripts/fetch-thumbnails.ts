import { createClient } from "@supabase/supabase-js";
import { fetchThumbnail } from "../src/lib/thumbnails";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  ref = process.env.ANIPAFE_PROJECT_REF;
if (!ref || new URL(url).hostname !== `${ref}.supabase.co`)
  throw new Error("専用プロジェクトの確認が必要です。");
const db = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const yearArgument = process.argv.indexOf("--year");
const year =
  yearArgument === -1 ? 2026 : Number(process.argv[yearArgument + 1]);
if (!Number.isInteger(year) || year < 2000 || year > 2100)
  throw new Error("--year に対象年度（2000～2100）を指定してください。");
const { data, error } = await db
  .from("data_mad")
  .select("video_id")
  .eq("year", year)
  .eq("is_active", true)
  .is("thumbnail_url", null);
if (error) throw error;
let ok = 0,
  failed = 0;
for (const row of data ?? []) {
  try {
    const thumbnail_url = await fetchThumbnail(row.video_id);
    const { error } = await db
      .from("data_mad")
      .update({ thumbnail_url })
      .eq("year", year)
      .eq("video_id", row.video_id);
    if (error) throw error;
    ok++;
  } catch {
    failed++;
    console.log(`${row.video_id}: 取得失敗（作品は保持）`);
  }
  await new Promise((r) => setTimeout(r, 350));
}
console.log({ year, ok, failed });
