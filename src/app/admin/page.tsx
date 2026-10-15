import { redirect } from "next/navigation";
import { pageUser } from "@/lib/auth";
import { AdminDashboard } from "@/components/admin-dashboard";
import { adminRows } from "@/lib/admin-data";
import type { Profile, Ballot } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const { db, user } = await pageUser();
  const { data: admin, error } = await db
    .from("master_admin_users")
    .select("auth_user_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error || !admin) redirect("/profile");
  const [report, poll, videos, profiles, ballots, audit] = await Promise.all([
    db.rpc("admin_report"),
    db.from("master_poll_settings").select("*").eq("id", 1).single(),
    db.from("data_mad").select("*").order("display_order"),
    adminRows<Profile>(db, "data_profiles").then((data) => ({
      data,
      error: null,
    })),
    adminRows<Ballot>(db, "data_ballot").then((data) => ({
      data,
      error: null,
    })),
    db
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  for (const r of [report, poll, videos, profiles, ballots, audit])
    if (r.error) throw new Error("運営データの読み込みに失敗しました。");
  return (
    <>
      <main id="main" className="admin-main">
        <AdminDashboard
          report={report.data}
          poll={poll.data}
          videos={videos.data ?? []}
          profiles={profiles.data ?? []}
          ballots={ballots.data ?? []}
          audit={audit.data ?? []}
        />
      </main>
    </>
  );
}
