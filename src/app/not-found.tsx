import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="narrow">
      <h1>ページが見つかりません</h1>
      <Link href="/">トップへ戻る</Link>
    </main>
  );
}
