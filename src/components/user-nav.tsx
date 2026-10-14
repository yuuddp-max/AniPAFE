import Link from "next/link";
export function UserNav({
  name,
  admin = false,
}: {
  name: string;
  admin?: boolean;
}) {
  return (
    <nav className="user-nav" aria-label="アカウント">
      <span className="user-name">● {name}</span>
      <Link href="/profile">マイプロフィール</Link>
      {admin && <Link href="/admin">運営管理</Link>}
      <form action="/auth/logout" method="post">
        <button className="text-button">ログアウト</button>
      </form>
    </nav>
  );
}
