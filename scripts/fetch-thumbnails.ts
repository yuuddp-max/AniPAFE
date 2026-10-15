import { createClient } from "@supabase/supabase-js";
import { fetchThumbnail } from "../src/lib/thumbnails";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  ref = process.env.ANIPAFE_PROJECT_REF;
if (!ref || new URL(url).hostname !== `${ref}.supabase.co`)
  throw new Error("専用プロジェクトの確認が必要です。");
const db = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const { data, error } = await db
  .from("data_mad")
  .select("video_id")
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
      .eq("video_id", row.video_id);
    if (error) throw error;
    ok++;
  } catch {
    failed++;
    console.log(`${row.video_id}: 取得失敗（作品は保持）`);
  }
  await new Promise((r) => setTimeout(r, 350));
}
console.log({ ok, failed });
