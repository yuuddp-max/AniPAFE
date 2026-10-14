import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { parseImport } from "../src/lib/importer";
import { fixtureCsv, fixtureSeedSql } from "./fixtures";
export const U1 = "00000000-0000-4000-8000-000000000001",
  U2 = "00000000-0000-4000-8000-000000000002",
  ADMIN = "00000000-0000-4000-8000-000000000003",
  OTHER = "00000000-0000-4000-8000-000000000004";
export async function database() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key);create table auth.identities(user_id uuid references auth.users,provider text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
    insert into auth.users values ('${U1}'),('${U2}'),('${ADMIN}'),('${OTHER}');
    insert into auth.identities values ('${U1}','google'),('${U2}','google'),('${ADMIN}','google'),('${OTHER}','email');`);
  const migrations = (await readdir("supabase/migrations"))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  for (const name of migrations)
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  const seed = await parseImport(await fixtureCsv(), "videos_seed.csv");
  // Execute the delivered seed verbatim, including escaping and thumbnail updates.
  await db.exec(await fixtureSeedSql());
  await db.exec(
    `insert into public.admin_users values ('${ADMIN}');update public.poll_settings set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day',is_published=true where id=1;`,
  );
  return { db, videos: seed.videos };
}
export async function call(
  db: PGlite,
  uid: string | null,
  sql: string,
  params: unknown[] = [],
  role = "authenticated",
) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role};`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      uid ?? "",
    ]);
    return tx.query(sql, params);
  });
}
export function minimum(
  videos: Awaited<ReturnType<typeof database>>["videos"],
) {
  const first = videos.filter((v) => v.author_nico_user_id !== "350396"),
    theme = first.find((v) => v.theme)!;
  return [
    ...first.slice(0, 5).map((v) => ({
      award_code: "overall",
      video_id: v.video_id,
      comment: "",
    })),
    ...["music", "composition", "creative", "humor"].map((a) => ({
      award_code: a,
      video_id: first[0].video_id,
      comment: a === "music" ? "<script>alert(1)</script>\n=SUM(1,2)" : "",
    })),
    {
      award_code: "theme",
      video_id: theme.video_id,
      comment: "テーマ賞の感想",
    },
  ];
}
