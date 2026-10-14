import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { parseImport } from "../src/lib/importer";
const file =
  process.argv.find((a) => /\.(csv|xlsx)$/i.test(a)) ?? "videos_seed.csv";
const report = await parseImport(await readFile(file), file);
console.log(
  JSON.stringify(
    { ...report, videos: undefined, active: report.videos.length },
    null,
    2,
  ),
);
if (report.errors.length)
  throw new Error("不正行があります。修正後に再実行してください。");
if (
  process.argv.includes("--initial") &&
  (report.videos.length !== 107 || report.themed !== 55)
)
  throw new Error("初期件数が107/55と一致しません。");
if (process.argv.includes("--apply")) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    ref = process.env.ANIPAFE_PROJECT_REF;
  if (!ref || new URL(url).hostname !== `${ref}.supabase.co`)
    throw new Error(
      "専用プロジェクトのURLとANIPAFE_PROJECT_REFを確認してください。",
    );
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("サーバー専用キーが必要です。");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("bootstrap_import", {
    p_videos: report.videos,
    p_initial: process.argv.includes("--initial"),
  });
  if (error) throw error;
  console.log(data);
} else
  console.log(
    "プレビューのみ。--apply --initialで新規サイトへ初期取込。既存マスター変更は管理画面を使用してください。",
  );
