import type { Metadata } from "next";
import Link from "next/link";
import { identity } from "@/lib/auth";
import { UserNav } from "@/components/user-nav";
import { googleAvatar } from "@/lib/avatar";
import "./globals.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "AniPAFE2026 人気投票", template: "%s | AniPAFE2026" },
  description: "心に残った、その一作へ。AniPAFE2026参加作品の人気投票サイト。",
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await identity();
  let name: string | null = null;
  let admin = false;
  if (auth) {
    const [profile, access] = await Promise.all([
      auth.db
        .from("data_profiles")
        .select("display_name")
        .eq("user_id", auth.user.id)
        .maybeSingle(),
      auth.db
        .from("master_admin_users")
        .select("auth_user_id")
        .eq("auth_user_id", auth.user.id)
        .maybeSingle(),
    ]);
    name =
      profile.data?.display_name ??
      (String(
        auth.user.user_metadata.full_name ?? auth.user.user_metadata.name ?? "",
      ).trim() ||
        "Googleユーザー");
    admin = !access.error && !!access.data;
  }
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          本文へ移動
        </a>
        <header className="site-header">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              A<span>✦</span>
            </span>
            <span>
              AniPAFE<span className="brand-year">2026</span>
              <small>ANIME MAD FESTIVAL</small>
            </span>
          </Link>
          <UserNav
            name={name}
            admin={admin}
            avatarUrl={auth ? googleAvatar(auth.user) : null}
          />
        </header>
        {children}
        <footer className="site-footer">
          <span>AniPAFE2026 人気投票</span>
          <span>作品への想いを、一票に。</span>
          <Link href="/privacy">プライバシーについて</Link>
        </footer>
      </body>
    </html>
  );
}
