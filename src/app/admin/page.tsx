import { redirect } from "next/navigation";
import { pageUser } from "@/lib/auth";
import { AdminDashboard } from "@/components/admin-dashboard";
import { pollHeader } from "@/lib/poll";
import { loadTally } from "@/lib/tally-data";
import "./dashboard.css";
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const { db, user } = await pageUser();
  const { data: admin, error } = await db
    .from("master_admin_users")
    .select("auth_user_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error || !admin) redirect("/profile");
  const { year } = await pollHeader();
  const [report, years, initialTally] = await Promise.all([
    db.rpc("admin_summary"),
    db
      .from("master_poll_settings")
      .select("*")
      .order("year", { ascending: false }),
    loadTally(db, year, "auto", 143),
  ]);
  for (const r of [report, years])
    if (r.error) throw new Error("運営データの読み込みに失敗しました。");
  // The year list already contains the current settings. Reuse it instead of
  // delaying all three reads behind a separate currentPoll query.
  const poll = years.data?.find((settings) => settings.year === year);
  if (!poll) throw new Error("投票設定を取得できませんでした。");
  if (report.data.year !== year)
    throw new Error("対象年度が変更されました。再読み込みしてください。");
  return (
    <>
      <main id="main" className="admin-main">
        <AdminDashboard
          key={poll.year}
          report={{ stats: report.data.stats }}
          initialTally={initialTally}
          poll={poll}
          years={years.data ?? []}
        />
      </main>
    </>
  );
}
