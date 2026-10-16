"use client";
import type { AwardCode } from "@/lib/types";
import { isOriginalSelection } from "@/lib/original-votes";
import { useVotes } from "./vote-provider";

export function LinkedOriginalVotes({ code }: { code?: AwardCode }) {
  const { data, original } = useVotes();
  if (!original) return null;
  return (
    <main id="main" className="review-main linked-original-votes">
      <div className="review-title">
        <span className="eyebrow">LINKED FORM RESPONSE</span>
        <h2>
          {code
            ? data.awards.find((award) => award.code === code)?.name
            : "紐付け済みの投票内容"}
        </h2>
        <p>
          過去フォーム原本の選択作品と感想です。原本は閲覧のみで、サイトの投票とは別に保持しています。
        </p>
      </div>
      {data.awards
        .filter((award) => !code || award.code === code)
        .map((award) => {
          const entries = original.entries.filter(
            (entry) => entry.award_code === award.code,
          );
          return (
            <section
              key={award.code}
              className="review-award"
              aria-label={`${award.name}の原本投票`}
            >
              <div>
                <h3>{award.name}</h3>
                <span>{entries.filter(isOriginalSelection).length}作品</span>
              </div>
              {entries.length === 0 && (
                <p className="muted">この部門の回答はありません。</p>
              )}
              {entries.map((entry) => (
                <article key={entry.id}>
                  <span className="review-video-no">
                    {entry.source_video_number
                      ? String(entry.source_video_number).padStart(3, "0")
                      : "—"}
                  </span>
                  <div>
                    <h4>{entry.title}</h4>
                    {entry.author_name && (
                      <p className="muted">{entry.author_name}</p>
                    )}
                    {!entry.video_id && isOriginalSelection(entry) && (
                      <p className="muted">原本の作品情報で表示しています。</p>
                    )}
                    {entry.comment ? (
                      <p className="review-comment">{entry.comment}</p>
                    ) : (
                      <p className="muted">感想は未入力です。</p>
                    )}
                  </div>
                  {entry.watch_url &&
                    /^https:\/\/www\.nicovideo\.jp\/watch\/(sm|so|nm)\d+$/.test(
                      entry.watch_url,
                    ) && (
                      <a
                        href={entry.watch_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        動画を見る ↗
                      </a>
                    )}
                </article>
              ))}
            </section>
          );
        })}
    </main>
  );
}
