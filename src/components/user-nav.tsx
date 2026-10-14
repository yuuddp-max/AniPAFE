import Link from "next/link";
export function UserNav({
  name,
  admin = false,
}: {
  name: string | null;
  admin?: boolean;
}) {
  return (
    <nav className="user-nav" aria-label="アカウント">
      <span className="user-identity">
        {name ? (
          <>
            <span className="login-state">ログイン中</span>
            <span className="user-name" title={name}>
              {name}
            </span>
          </>
        ) : (
          <span className="muted">未ログイン</span>
        )}
      </span>
      <Link className="button small" href="/vote/overall">
        投票画面へ
      </Link>
      {name && <Link href="/profile">マイプロフィール</Link>}
      {admin && <Link href="/admin">運営管理</Link>}
      {name ? (
        <form action="/auth/logout" method="post">
          <button className="text-button">ログアウト</button>
        </form>
      ) : (
        <Link href="/login">ログイン</Link>
      )}
    </nav>
  );
}
