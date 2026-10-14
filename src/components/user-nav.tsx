"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
export function UserNav({
  name,
  admin = false,
}: {
  name: string | null;
  admin?: boolean;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const account = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!account.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <nav className="user-nav" aria-label="アカウント">
      <div className="site-nav-links">
        <Link
          href="/vote/overall"
          aria-current={path.startsWith("/vote/") ? "page" : undefined}
          onClick={() => setOpen(false)}
        >
          投票画面へ
        </Link>
        {admin && (
          <Link
            href="/admin"
            aria-current={path === "/admin" ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            運営管理
          </Link>
        )}
      </div>
      {name ? (
        <div className="account-menu" ref={account}>
          <button
            className="account-trigger"
            ref={trigger}
            aria-label={`ユーザーメニュー：${name}`}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="account-avatar" aria-hidden="true">
              {Array.from(name)[0]?.toLocaleUpperCase()}
            </span>
            <span className="user-identity">
              <span className="login-state">ログイン中</span>
              <span className="user-name" title={name}>
                {name}
              </span>
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
          {open && (
            <div className="account-dropdown" id={menuId}>
              <Link href="/profile" onClick={() => setOpen(false)}>
                マイプロフィール
              </Link>
              <form action="/auth/logout" method="post">
                <button>ログアウト</button>
              </form>
            </div>
          )}
        </div>
      ) : (
        <div className="guest-account">
          <span className="muted">未ログイン</span>
          <Link className="button small" href="/login">
            ログイン
          </Link>
        </div>
      )}
    </nav>
  );
}
