import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "AniPAFE2026 人気投票", template: "%s | AniPAFE2026" },
  description: "心に残った、その一作へ。AniPAFE2026参加作品の人気投票サイト。",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
          <span className="header-label">みんなで選ぶ、今年の一作。</span>
          <span className="header-pill">人気投票</span>
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
