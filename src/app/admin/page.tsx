import { redirect } from "next/navigation";
import { pageUser } from "@/lib/auth";
import { AdminDashboard } from "@/components/admin-dashboard";
import { loadAdminYear } from "@/lib/admin-year-data";
import { currentPoll } from "@/lib/poll";
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
  const poll = await currentPoll(db);
  const [report, years, initialVideos, initialVoters, audit] =
    await Promise.all([
      db.rpc("admin_summary"),
      db
        .from("master_poll_settings")
        .select("*")
        .order("year", { ascending: false }),
      loadAdminYear(db, poll.year, "videos"),
      loadAdminYear(db, poll.year, "voters"),
      db
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
  for (const r of [report, years, audit])
    if (r.error) throw new Error("運営データの読み込みに失敗しました。");
  if (report.data.year !== poll.year)
    throw new Error("対象年度が変更されました。再読み込みしてください。");
  const initialTally = await loadTally(db, poll.year, "auto", 143, true);
  return (
    <>
      <main id="main" className="admin-main">
        <AdminDashboard
          key={poll.year}
          report={{ stats: report.data.stats }}
          initialTally={initialTally}
          poll={poll}
          years={years.data ?? []}
          initialVideos={initialVideos}
          initialVoters={initialVoters}
          audit={audit.data ?? []}
        />
      </main>
    </>
  );
}
