"use client";
import { useRef, useState } from "react";
import { tallyAwards, type TallyResult } from "@/lib/tally";

export function TallyPanel({
  years,
  initialResult,
}: {
  years: number[];
  initialResult: TallyResult;
}) {
  const [year, setYear] = useState(initialResult.year);
  const [source, setSource] = useState(initialResult.source);
  const [denominator, setDenominator] = useState(
    String(initialResult.score_denominator),
  );
  const [result, setResult] = useState<TallyResult | null>(initialResult);
  const [award, setAward] = useState("overall");
  const [view, setView] = useState("ranking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  function clear() {
    requestId.current++;
    setResult(null);
    setError("");
    setBusy(false);
  }
  async function calculate() {
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const query = new URLSearchParams({
        year: String(year),
        source,
        denominator,
      });
      const response = await fetch(`/api/admin/tally?${query}`, {
        signal: AbortSignal.timeout(40000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (id === requestId.current) setResult(data);
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  const exportQuery = result
    ? new URLSearchParams({
        year: String(result.year),
        source: result.source,
        denominator: String(result.score_denominator),
      })
    : null;
  return (
    <section className="admin-panel" aria-label="Excel方式の集計">
      <h2>Excel方式の集計</h2>
      <p>
        年度と集計元を選んで、部門得点・同点時の補助合計・順位・スコアを計算します。
      </p>
      <p className="muted">
        過去フォーム原本は比較用の暫定集計です。製作者加点が未確認の作品は未加算で計算します。
      </p>
      <form
        className="admin-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void calculate();
        }}
      >
        <label>
          集計年度
          <select
            value={year}
            onChange={(e) => {
              clear();
              setYear(Number(e.target.value));
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年度
              </option>
            ))}
          </select>
        </label>
        <label>
          集計元
          <select
            value={source}
            onChange={(e) => {
              clear();
              setSource(e.target.value);
            }}
          >
            <option value="historical">過去フォーム原本（暫定）</option>
            <option value="site">サイトの確定済み投票</option>
          </select>
        </label>
        <label>
          スコア分母
          <input
            type="number"
            min={1}
            max={100000}
            required
            value={denominator}
            onChange={(e) => {
              clear();
              setDenominator(e.target.value);
            }}
          />
        </label>
        <button className="button small" disabled={busy}>
          {busy ? "集計中…" : "Excel方式で集計"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <>
          <p aria-live="polite" aria-label="集計結果の概要">
            {result.year}年度・
            {result.source === "historical"
              ? "過去フォーム原本"
              : "サイト確定票"}
            ：{result.ballot_count}回答／{result.selection_count}
            票／作品選択なしの感想{result.comment_only_count}件。
            {result.provisional
              ? "製作者加点は未確認のため暫定です。"
              : "製作者加点を確認済みです。"}
          </p>
          {result.provisional && <p className="muted">{result.warnings[0]}</p>}
          <details>
            <summary>計算ルールと集計上の注意</summary>
            {result.warnings
              .slice(result.provisional ? 1 : 0)
              .map((warning) => (
                <p className="muted" key={warning}>
                  {warning}
                </p>
              ))}
          </details>
          <div className="admin-toolbar">
            <label>
              表示内容
              <select value={view} onChange={(e) => setView(e.target.value)}>
                <option value="ranking">部門順位</option>
                <option value="score">スコア計算</option>
              </select>
            </label>
            {view === "ranking" && (
              <label>
                Excel集計部門
                <select
                  value={award}
                  onChange={(e) => setAward(e.target.value)}
                >
                  {tallyAwards.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <a
              className="button secondary small"
              href={`/api/admin/tally?${exportQuery}&format=ranking`}
            >
              Excel方式ランキングCSV ↓
            </a>
            <a
              className="button secondary small"
              href={`/api/admin/tally?${exportQuery}&format=score`}
            >
              スコアCSV ↓
            </a>
          </div>
          {result.ballot_count === 0 && (
            <p>この年度・集計元の投票データはありません。</p>
          )}
          {view === "ranking" ? (
            <div className="table-scroll">
              <table>
                <caption>
                  {result.year}年度{" "}
                  {tallyAwards.find((a) => a.code === award)?.name}（暫定）
                </caption>
                <thead>
                  <tr>
                    <th>順位（相対）</th>
                    <th>順位（絶対）</th>
                    <th>作品番号・作品名</th>
                    <th>製作者</th>
                    <th>票数</th>
                    <th>製作者加点</th>
                    <th>得点</th>
                    <th>補助合計</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rankings
                    .filter((r) => r.award_code === award)
                    .map((r) => (
                      <tr key={r.display_order}>
                        <td>{r.relative_rank}</td>
                        <td>{r.absolute_rank}</td>
                        <td>
                          No.{r.display_order} {r.title}
                          {r.unmapped && <small>作品未対応</small>}
                        </td>
                        <td>{r.author_name}</td>
                        <td>{r.votes}</td>
                        <td>
                          {r.award_code === "overall"
                            ? (r.creator_bonus ?? "未確認")
                            : "対象外"}
                        </td>
                        <td>
                          {r.points === r.max_points
                            ? r.points
                            : `${r.points}～${r.max_points}`}
                        </td>
                        <td>{r.total_points}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <caption>
                  {result.year}年度 スコア計算（分母{result.score_denominator}
                  ・暫定）
                </caption>
                <thead>
                  <tr>
                    <th>作品番号・作品名</th>
                    <th>製作者</th>
                    {tallyAwards.map((a) => (
                      <th key={a.code}>{a.name}順位</th>
                    ))}
                    <th>受賞数（総合除く）</th>
                    <th>スコア</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scores.map((r) => (
                    <tr key={r.display_order}>
                      <td>
                        No.{r.display_order} {r.title}
                      </td>
                      <td>{r.author_name}</td>
                      {tallyAwards.map((a) => (
                        <td key={a.code}>{r.ranks[a.code] ?? "圏外"}</td>
                      ))}
                      <td>{r.award_count}</td>
                      <td>{r.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
