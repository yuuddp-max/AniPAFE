import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseImport } from "../src/lib/importer";
import { fetchThumbnail } from "../src/lib/thumbnails";
const { videos, themed, errors } = await parseImport(
  await readFile("videos_seed.csv"),
  "videos_seed.csv",
);
if (videos.length !== 107 || themed !== 55 || errors.length)
  throw new Error("初期データ件数不一致");
await mkdir("data", { recursive: true });
let cache: Record<string, string> = {};
try {
  cache = JSON.parse(await readFile("data/thumbnail-cache.json", "utf8"));
} catch {}
let failed = 0;
if (process.argv.includes("--fetch"))
  for (const v of videos) {
    if (cache[v.video_id]) continue;
    try {
      cache[v.video_id] = await fetchThumbnail(v.video_id);
    } catch {
      failed++;
      console.log(`${v.video_id}: 取得失敗。作品は保持します。`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
await writeFile(
  "data/thumbnail-cache.json",
  JSON.stringify(cache, null, 2) + "\n",
);
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
let sql = `-- Generated from videos_seed.csv; metadata URLs verified via getthumbinfo.\nselect public.bootstrap_import(${literal(JSON.stringify(videos))}::jsonb,true);\n`;
for (const [id, url] of Object.entries(cache))
  sql += `update public.videos set thumbnail_url=${literal(url)} where video_id=${literal(id)};\n`;
await writeFile("supabase/seed.sql", sql);
console.log({
  videos: videos.length,
  themed,
  thumbnails: Object.keys(cache).length,
  failed,
});
