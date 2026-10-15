import { redirect } from "next/navigation";
import { pageUser } from "@/lib/auth";
import { AdminDashboard } from "@/components/admin-dashboard";
import { adminRows } from "@/lib/admin-data";
import type { Profile, Ballot } from "@/lib/types";
import { currentPoll } from "@/lib/poll";
import { loadTally } from "@/lib/tally-data";
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
  const [report, years, videos, profiles, ballots, audit] = await Promise.all([
    db.rpc("admin_report"),
    db
      .from("master_poll_settings")
      .select("*")
      .order("year", { ascending: false }),
    db
      .from("data_mad")
      .select("*")
      .eq("year", poll.year)
      .order("display_order"),
    adminRows<Profile>(db, "data_profiles").then((data) => ({
      data,
      error: null,
    })),
    adminRows<Ballot>(db, "data_ballot", poll.year).then((data) => ({
      data,
      error: null,
    })),
    db
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  for (const r of [report, years, videos, profiles, ballots, audit])
    if (r.error) throw new Error("運営データの読み込みに失敗しました。");
  if (report.data.year !== poll.year)
    throw new Error("対象年度が変更されました。再読み込みしてください。");
  const tallyYear = years.data?.some((y) => y.year === 2025) ? 2025 : poll.year;
  const initialTally = await loadTally(
    db,
    tallyYear,
    tallyYear === 2025 ? "historical" : "site",
    143,
  );
  return (
    <>
      <main id="main" className="admin-main">
        <AdminDashboard
          key={poll.year}
          report={report.data}
          initialTally={initialTally}
          poll={poll}
          years={years.data ?? []}
          videos={videos.data ?? []}
          profiles={profiles.data ?? []}
          ballots={ballots.data ?? []}
          audit={audit.data ?? []}
        />
      </main>
    </>
  );
}
