"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useVotes } from "./vote-provider";
import { jst } from "@/lib/validation";
export function VoteShell({ children }: { children: React.ReactNode }) {
  const { data, entries, state, message, save, submitted } = useVotes();
  const path = usePathname();
  return (
    <>
      <div className="vote-heading">
        <div>
          <span className="eyebrow">AUDIENCE AWARDS · 2026</span>
          <h1>あなたの「好き」を、一票に。</h1>
          <p>6つの賞から、心に残った作品を選んでください。</p>
        </div>
        <div className="poll-dates">
          <span>投票期間（日本時間）</span>
          <strong>
            {jst(data.poll.starts_at)}
            <br />〜 {jst(data.poll.ends_at)}
          </strong>
        </div>
      </div>
      <div className="vote-status" role="status">
        <span>
          {submitted
            ? "✓ 投票は確定済みです"
            : state === "saved"
              ? "✓ 下書きを保存済み"
              : state === "pending"
                ? "● 未保存の変更があります"
                : state === "saving"
                  ? "◌ 下書きを保存中…"
                  : "! 下書きの保存に失敗しました"}
        </span>
        <span>
          {submitted
            ? "確定後の修正は運営へお問い合わせください。"
            : "感想は任意です。選択内容は自動保存されます。"}
        </span>
      </div>
      {state === "error" && (
        <div className="error save-error" role="alert">
          {message}
          <button className="button small" onClick={() => void save()}>
            再試行
          </button>
          <a href={path}>再読み込み</a>
        </div>
      )}
      <nav className="award-tabs" aria-label="投票部門">
        {data.awards.map((a) => {
          const n = entries.filter((e) => e.award_code === a.code).length;
          return (
            <Link
              href={`/vote/${a.code}`}
              key={a.code}
              aria-current={path === `/vote/${a.code}` ? "page" : undefined}
            >
              <span>{a.name}</span>
              <small
                className={`award-count${n >= a.min_votes ? " complete" : ""}`}
                title={
                  n >= a.min_votes
                    ? "必要票数を満たしています"
                    : `あと${a.min_votes - n}作品で必要票数を満たします`
                }
              >
                {n >= a.min_votes ? "✓ " : ""}
                {n}/{a.max_votes}
              </small>
            </Link>
          );
        })}
      </nav>
      {children}
    </>
  );
}
