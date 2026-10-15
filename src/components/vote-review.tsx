"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useVotes } from "./vote-provider";
import { pollIsOpen, jst } from "@/lib/validation";
export function VoteReview({ complete = false }: { complete?: boolean }) {
  const { data, entries, save, revision, submitted, markSubmitted, state } =
      useVotes(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ready = data.awards.every((a) => {
    const n = entries.filter((e) => e.award_code === a.code).length;
    return n >= a.min_votes && n <= a.max_votes;
  });
  async function submit() {
    if (
      !window.confirm(
        "この内容で投票を確定しますか？確定後はご自身で編集できません。",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (!(await save()))
        throw new Error(
          "下書きを保存できませんでした。保存エラーを解消してください。",
        );
      const response = await fetch("/api/ballot/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: revision.current,
          year: data.poll.year,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      markSubmitted();
      router.replace("/vote/complete");
      router.refresh();
    } catch (e) {
      setError(
        (e as Error).message || "確定に失敗しました。再試行してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="review-main">
      <div className="review-title">
        <span className="eyebrow">
          {submitted ? "THANK YOU FOR YOUR VOTE" : "REVIEW YOUR BALLOT"}
        </span>
        <h2>
          {submitted
            ? "投票完了。想いを届けました。"
            : complete
              ? "まだ投票は確定していません。"
              : "最後に、あなたの一票を確認。"}
        </h2>
        <p>
          {submitted
            ? `ご参加ありがとうございます。${data.ballot?.submitted_at ? `確定日時：${jst(data.ballot.submitted_at)}` : ""}`
            : "選択順による順位点はありません。各作品を一票として集計します。"}
        </p>
      </div>
      {data.awards.map((a) => (
        <section className="review-award" key={a.code}>
          <div>
            <h3>{a.name}</h3>
            <span>
              {entries.filter((e) => e.award_code === a.code).length}作品 /{" "}
              {a.min_votes}～{a.max_votes}作品
            </span>
            {!submitted && <Link href={`/vote/${a.code}`}>編集する →</Link>}
          </div>
          {entries
            .filter((e) => e.award_code === a.code)
            .map((e) => {
              const v = data.videos.find((v) => v.video_id === e.video_id);
              return (
                <article key={e.video_id}>
                  <span className="review-video-no">
                    {String(v?.display_order ?? "").padStart(3, "0")}
                  </span>
                  <div>
                    <h4>{v?.title ?? e.video_id}</h4>
                    <p className="muted">
                      {v?.author_name} · {e.video_id}
                    </p>
                    {e.comment && <p className="review-comment">{e.comment}</p>}
                  </div>
                  <a
                    href={
                      v?.watch_url ??
                      `https://www.nicovideo.jp/watch/${e.video_id}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    動画を見る ↗
                  </a>
                </article>
              );
            })}
        </section>
      ))}
      {!submitted && (
        <div className="submit-panel">
          <p>
            6部門の選択と感想をご確認ください。
            <br />
            確定後の変更には、運営者による投票の再開が必要です。
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button"
            disabled={
              busy || !ready || !pollIsOpen(data.poll) || state !== "saved"
            }
            onClick={submit}
          >
            {busy ? "投票を確定中…" : "この内容で投票を確定する"}
          </button>
          {!ready && (
            <p className="error">
              6部門すべてで、表示された下限～上限の作品数に調整してください。
            </p>
          )}
        </div>
      )}
    </main>
  );
}
