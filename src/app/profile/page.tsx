import { pageUser } from "@/lib/auth";
import { ProfileForm } from "@/components/profile-form";
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  const { db, user } = await pageUser();
  const [p, b] = await Promise.all([
    db.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
    db.from("ballots").select("status").eq("voter_id", user.id).maybeSingle(),
  ]);
  if (p.error || b.error) throw new Error("プロフィール取得に失敗しました。");
  const googleName = String(
    user.user_metadata.full_name ?? user.user_metadata.name ?? "",
  );
  return (
    <>
      <main id="main" className="narrow">
        <span className="eyebrow">YOUR PROFILE</span>
        <h1>投票の前に、あなたのこと。</h1>
        <p className="muted">
          作品への一票を大切にするため、プロフィールを登録してください。
        </p>
        {!p.data && (
          <p className="notice">
            Googleログインが完了しました。ユーザー名とニコニコユーザーIDを保存すると、投票画面へ進めます。
          </p>
        )}
        <ProfileForm
          profile={p.data}
          googleName={googleName}
          locked={b.data?.status === "submitted"}
        />
      </main>
    </>
  );
}
