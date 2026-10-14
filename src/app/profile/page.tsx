import { pageUser } from "@/lib/auth";
import { ProfileForm } from "@/components/profile-form";
import { UserNav } from "@/components/user-nav";
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  const { db, user } = await pageUser();
  const [p, b, a] = await Promise.all([
    db.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
    db.from("ballots").select("status").eq("voter_id", user.id).maybeSingle(),
    db
      .from("admin_users")
      .select("auth_user_id")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
  ]);
  if (p.error || b.error || a.error)
    throw new Error("プロフィール取得に失敗しました。");
  const googleName = String(
    user.user_metadata.full_name ?? user.user_metadata.name ?? "",
  );
  return (
    <>
      <UserNav name={p.data?.display_name ?? googleName} admin={!!a.data} />
      <main id="main" className="narrow">
        <span className="eyebrow">YOUR PROFILE</span>
        <h1>投票の前に、あなたのこと。</h1>
        <p className="muted">
          作品への一票を大切にするため、プロフィールを登録してください。
        </p>
        <ProfileForm
          profile={p.data}
          googleName={googleName}
          locked={b.data?.status === "submitted"}
        />
      </main>
    </>
  );
}
