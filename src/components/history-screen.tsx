"use client";
import Link from "next/link";
import { useState } from "react";
import type { VoteHistory } from "@/lib/types";
import { jst } from "@/lib/validation";

export function HistoryScreen({ data }: { data: VoteHistory }) {
  const [tab, setTab] = useState<"mine" | "results">("mine");
  const [award, setAward] = useState("overall");
  const poll = data.poll;
  const entries = data.entries ?? [];
  const rankings = data.rankings ?? [];
  return (
    <>
      <div className="history-heading">
        <div>
          <span className="eyebrow">VOTING ARCHIVE</span>
          <h1>過去投票データ</h1>
          <p className="muted">
            あの年、心に残った作品と、あなたの一票を振り返る。
          </p>
          <p className="notice">現在データ整理中（工事中）</p>
        </div>
        <Link className="button secondary small" href="/vote/overall">
          現在の投票画面へ →
        </Link>
      </div>
      {!data.years.length ? (
        <section className="history-empty">
          <span aria-hidden="true">✦</span>
          <h2>過去年度の投票データはまだありません</h2>
          <p>
            年度が切り替わると、ここから自分の投票と公開済みの結果を確認できます。
          </p>
        </section>
      ) : (
        <>
          <nav className="history-years" aria-label="過去の投票年度">
            {data.years.map((y) => (
              <Link
                key={y.year}
                className="history-year-card"
                href={`/history?year=${y.year}`}
                aria-current={poll?.year === y.year ? "page" : undefined}
              >
                <span className="history-year-number">
                  {y.year}
                  <small>年度</small>
                </span>
                <strong>{y.title}</strong>
                <span className="history-badges">
                  <span>
                    {y.status === "submitted"
                      ? "投票済み"
                      : y.status === "draft"
                        ? "下書きあり・未確定"
                        : "投票記録なし"}
                  </span>
                  <span>{y.results_public ? "結果公開中" : "結果未公開"}</span>
                </span>
                <small>
                  {y.status === "submitted"
                    ? `確定：${jst(y.submitted_at)}`
                    : y.entry_count
                      ? `保存済み ${y.entry_count}件`
                      : "年度の詳細を見る"}{" "}
                  →
                </small>
              </Link>
            ))}
          </nav>
          {!poll ? (
            <p className="history-hint">
              年度を選ぶと、自分の投票内容と公開済みの投票結果を表示します。
            </p>
          ) : (
            <section
              className="history-detail"
              aria-label={`${poll.year}年度の投票データ`}
            >
              <div className="history-detail-title">
                <span className="eyebrow">{poll.year} ARCHIVE</span>
                <h2>{poll.title}</h2>
                <p className="muted">投票終了：{jst(poll.ends_at)}</p>
              </div>
              <nav className="admin-tabs" aria-label="過去データの表示内容">
                <button
                  aria-pressed={tab === "mine"}
                  onClick={() => setTab("mine")}
                >
                  自分の投票
                </button>
                <button
                  aria-pressed={tab === "results"}
                  onClick={() => setTab("results")}
                >
                  投票結果
                </button>
              </nav>
              {tab === "mine" ? (
                <>
                  <p className="notice">
                    {data.ballot?.status === "submitted"
                      ? `確定済みの投票です。確定日時：${jst(data.ballot.submitted_at)}`
                      : data.ballot
                        ? "保存された下書きです。投票は確定しておらず、集計には含まれていません。"
                        : "この年度の投票記録はありません。"}{" "}
                    過去の内容は閲覧専用です。
                  </p>
                  <p className="muted">
                    この投票内容・感想を見られるのは、ご本人と運営者だけです。
                  </p>
                  {entries.length ? (
                    Array.from(
                      new Map(entries.map((e) => [e.award_code, e.award_name])),
                    ).map(([code, name]) => (
                      <section className="history-award" key={code}>
                        <h3>
                          {name}
                          <small>
                            {
                              entries.filter((e) => e.award_code === code)
                                .length
                            }
                            作品
                          </small>
                        </h3>
                        {entries
                          .filter((e) => e.award_code === code)
                          .map((e) => (
                            <article key={e.video_id}>
                              <div>
                                <h4>
                                  <a
                                    href={e.watch_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {e.title} ↗
                                  </a>
                                </h4>
                                <p className="muted">
                                  {e.author_name} · {e.video_id}
                                </p>
                                {e.comment ? (
                                  <p className="review-comment">{e.comment}</p>
                                ) : (
                                  <small className="muted">
                                    感想は未入力です
                                  </small>
                                )}
                              </div>
                            </article>
                          ))}
                      </section>
                    ))
                  ) : data.ballot ? (
                    <p className="history-hint">保存された作品はありません。</p>
                  ) : null}
                </>
              ) : data.results_public ? (
                <>
                  <div className="admin-toolbar">
                    <label>
                      集計部門
                      <select
                        aria-label="過去結果の部門"
                        value={award}
                        onChange={(e) => setAward(e.target.value)}
                      >
                        {Array.from(
                          new Map(
                            rankings.map((r) => [r.award_code, r.award_name]),
                          ),
                        ).map(([code, name]) => (
                          <option key={code} value={code}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="muted">
                      確定票のみ集計。同得票は同順位です。
                    </p>
                  </div>
                  {rankings.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>順位</th>
                            <th>作品</th>
                            <th>投稿者</th>
                            <th>得票数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rankings
                            .filter((r) => r.award_code === award)
                            .map((r) => (
                              <tr key={r.video_id}>
                                <td>
                                  <span
                                    className={
                                      r.rank <= 3
                                        ? "history-rank top"
                                        : "history-rank"
                                    }
                                  >
                                    {r.rank}
                                  </span>
                                </td>
                                <td>
                                  {r.title}
                                  <small>{r.video_id}</small>
                                </td>
                                <td>{r.author_name}</td>
                                <td>
                                  <strong>{r.votes}</strong> 票
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="history-hint">
                      この年度には集計対象の作品がありません。
                    </p>
                  )}
                </>
              ) : (
                <div className="history-empty">
                  <h3>この年度の投票結果は未公開です</h3>
                  <p>
                    運営者が公開すると、ここに部門別の順位・得票数が表示されます。
                  </p>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
