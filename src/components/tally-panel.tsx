"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Download,
  Info,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { tallyAwards, type AdminTallyResult } from "@/lib/tally";
import { jst } from "@/lib/validation";
import { TallyMetrics, TallyOverview } from "@/components/tally-overview";

export function TallyPanel({
  years,
  initialResult,
  showDetails = false,
}: {
  years: number[];
  initialResult: AdminTallyResult;
  showDetails?: boolean;
}) {
  const [year, setYear] = useState(initialResult.year);
  const [source, setSource] = useState("auto");
  const [denominator, setDenominator] = useState(
    String(initialResult.score_denominator),
  );
  const [result, setResult] = useState<AdminTallyResult | null>(initialResult);
  const [detailPage, setDetailPage] = useState(0);
  const [award, setAward] = useState("overall");
  const [view, setView] = useState("ranking");
  const [query, setQuery] = useState("");
  const [expandedColumns, setExpandedColumns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const previousInitialResult = useRef(initialResult);
  function clear() {
    requestId.current++;
    setResult(null);
    setDetailPage(0);
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
        include_details: "1",
      });
      const response = await fetch(`/api/admin/tally?${query}`, {
        signal: AbortSignal.timeout(40000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (id === requestId.current) {
        setResult(data);
        setDetailPage(0);
      }
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  const refreshFromServer = useEffectEvent(() => {
    void calculate();
  });
  useEffect(() => {
    if (previousInitialResult.current === initialResult) return;
    previousInitialResult.current = initialResult;
    refreshFromServer();
  }, [initialResult]);
  const exportQuery = result
    ? new URLSearchParams({
        year: String(result.year),
        source: result.source,
        denominator: String(result.score_denominator),
      })
    : null;
  const search = query.trim().toLocaleLowerCase("ja-JP");
  const matches = (row: {
    title: string;
    author_name: string;
    display_order: number;
  }) =>
    !search ||
    `${row.title} ${row.author_name} ${row.display_order}`
      .toLocaleLowerCase("ja-JP")
      .includes(search);
  const rankingRows =
    result?.rankings.filter(
      (row) => row.award_code === award && matches(row),
    ) ?? [];
  const scoreRows =
    result?.scores
      .filter(matches)
      .toSorted(
        (a, b) => b.score - a.score || a.display_order - b.display_order,
      ) ?? [];
  return (
    <section
      className="tally-dashboard"
      aria-label="Excel方式の集計"
      aria-busy={busy}
    >
      <header className="tally-heading">
        <div>
          <span className="tally-kicker">VOTING ANALYTICS</span>
          <h2>{year}年度の集計結果</h2>
          <p>作品に届いた票を、ひとつのダッシュボードに。</p>
        </div>
        {result && (
          <span
            className={`tally-status${result.provisional ? " is-provisional" : ""}`}
          >
            <span aria-hidden="true" />
            {result.provisional ? "暫定集計" : "加点確認済み"}
          </span>
        )}
      </header>
      <form
        className="tally-controls"
        onSubmit={(e) => {
          e.preventDefault();
          void calculate();
        }}
      >
        <label>
          集計年度
          <select
            aria-label="集計年度"
            value={year}
            onChange={(e) => {
              clear();
              setYear(Number(e.target.value));
              setSource("auto");
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
            aria-label="集計元"
            value={source}
            onChange={(e) => {
              clear();
              setSource(e.target.value);
            }}
          >
            <option value="auto">集計年度のデータから自動選択</option>
            <option value="historical">過去フォーム原本（暫定）</option>
            <option value="site">サイトの確定済み投票</option>
          </select>
        </label>
        <label>
          <span>スコア分母</span>
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
          <RefreshCw
            size={15}
            aria-hidden="true"
            className={busy ? "tally-spin" : undefined}
          />
          {busy ? "集計中…" : "Excel方式で集計"}
        </button>
      </form>
      <p className="muted">
        上部の対象年度に関係なく、選んだ集計年度の投票を集計します。
        自動選択では過去フォーム原本がある年度は原本、それ以外はサイト確定票を使います。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!result && !error && (
        <div className="tally-empty" role="status">
          {busy
            ? "投票明細から得点・順位・スコアを再計算しています…"
            : "集計条件を変更しました。「Excel方式で集計」で結果を表示します。"}
        </div>
      )}
      {result && (
        <>
          <p
            className="tally-result-summary"
            aria-live="polite"
            aria-label="集計結果の概要"
          >
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
          <TallyMetrics result={result} />
          {result.provisional && (
            <div className="tally-notice">
              <Info size={18} aria-hidden="true" />
              <p>
                <strong>製作者加点は未確認です</strong>
                総合賞は各作品に最大＋1点の差が生じます。順位・スコアも変わる可能性があります。
              </p>
            </div>
          )}
          <TallyOverview
            result={result}
            award={award}
            onAwardChange={setAward}
          />
          <section className="tally-results-card" aria-label="集計順位とスコア">
            <div className="tally-section-heading tally-results-heading">
              <div>
                <span className="tally-kicker">RESULTS EXPLORER</span>
                <h3>集計結果の詳細</h3>
              </div>
              <div
                className="tally-view-switch"
                role="group"
                aria-label="表示内容"
              >
                {[
                  ["ranking", "部門順位"],
                  ["score", "スコア計算"],
                ].map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="tally-explorer-toolbar">
              <label className="tally-search">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="作品・製作者を検索"
                  placeholder="作品名・製作者・作品番号を検索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {view === "ranking" && (
                <label className="tally-department-select">
                  部門
                  <select
                    aria-label="Excel集計部門"
                    value={award}
                    onChange={(e) => setAward(e.target.value)}
                  >
                    {tallyAwards.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {view === "ranking" && (
                <label className="tally-column-toggle">
                  <input
                    type="checkbox"
                    checked={expandedColumns}
                    onChange={(e) => setExpandedColumns(e.target.checked)}
                  />
                  <SlidersHorizontal size={15} aria-hidden="true" />
                  補助合計・加点の詳細
                </label>
              )}
            </div>
            <div className="tally-export-row">
              <p aria-live="polite">
                {view === "ranking" ? rankingRows.length : scoreRows.length}
                作品を表示{search && "（検索で絞り込み中）"}
              </p>
              <div>
                <a
                  className="tally-export"
                  href={`/api/admin/tally?${exportQuery}&format=ranking`}
                >
                  <Download size={14} aria-hidden="true" />
                  Excel方式ランキングCSV ↓
                </a>
                <a
                  className="tally-export"
                  href={`/api/admin/tally?${exportQuery}&format=score`}
                >
                  <Download size={14} aria-hidden="true" />
                  スコアCSV ↓
                </a>
                {showDetails && (
                  <a
                    className="tally-export"
                    href={`/api/admin/tally?${exportQuery}&format=details`}
                  >
                    <Download size={14} aria-hidden="true" />
                    投票明細CSV ↓
                  </a>
                )}
              </div>
            </div>
            {result.ballot_count === 0 && (
              <p>この年度・集計元の投票データはありません。</p>
            )}
            {view === "ranking" ? (
              <>
                {!expandedColumns && (
                  <ol
                    className="tally-mobile-ranking"
                    aria-label={`${tallyAwards.find((item) => item.code === award)?.name}の順位一覧`}
                  >
                    {rankingRows.map((row) => (
                      <li key={row.display_order}>
                        <span
                          className={`tally-table-rank${row.relative_rank <= 3 ? " is-top" : ""}`}
                        >
                          {row.relative_rank}
                        </span>
                        <div>
                          <small>
                            No.{String(row.display_order).padStart(3, "0")}
                          </small>
                          <strong>{row.title}</strong>
                          <span>{row.author_name}</span>
                        </div>
                        <div className="tally-mobile-points">
                          <strong>
                            {row.votes}
                            <small>票</small>
                          </strong>
                          <span>
                            得点{" "}
                            {row.points === row.max_points
                              ? row.points
                              : `${row.points}～${row.max_points}`}
                          </span>
                        </div>
                      </li>
                    ))}
                    {rankingRows.length === 0 && (
                      <li className="tally-empty">
                        {search
                          ? "検索条件に一致する作品はありません。"
                          : "この部門の投票データはありません。"}
                      </li>
                    )}
                  </ol>
                )}
                <div
                  className={`table-scroll tally-table-scroll tally-rank-table-scroll${expandedColumns ? " is-expanded" : ""}`}
                  role="region"
                  aria-label="部門順位表（横スクロール可能）"
                  tabIndex={0}
                >
                  <table className="tally-table">
                    <caption>
                      {result.year}年度{" "}
                      {tallyAwards.find((a) => a.code === award)?.name}
                      {result.provisional ? "（暫定）" : ""}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">順位（相対）</th>
                        {expandedColumns && <th scope="col">順位（絶対）</th>}
                        <th scope="col">作品番号・作品名</th>
                        <th scope="col">製作者</th>
                        <th scope="col" className="tally-numeric">
                          票数
                        </th>
                        {expandedColumns && <th scope="col">製作者加点</th>}
                        <th scope="col" className="tally-numeric">
                          得点
                        </th>
                        {expandedColumns && (
                          <th scope="col" className="tally-numeric">
                            補助合計
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rankingRows.map((r) => (
                        <tr key={r.display_order}>
                          <td>
                            <span
                              className={`tally-table-rank${r.relative_rank <= 3 ? " is-top" : ""}`}
                            >
                              {r.relative_rank}
                            </span>
                          </td>
                          {expandedColumns && <td>{r.absolute_rank}</td>}
                          <td className="tally-work-cell">
                            <small>
                              No.{String(r.display_order).padStart(3, "0")}
                            </small>
                            <strong>{r.title}</strong>
                            {r.unmapped && <small>作品未対応</small>}
                          </td>
                          <td className="tally-author-cell">{r.author_name}</td>
                          <td className="tally-numeric tally-votes">
                            {r.votes}
                          </td>
                          {expandedColumns && (
                            <td>
                              {r.award_code === "overall"
                                ? (r.creator_bonus ?? "未確認")
                                : "対象外"}
                            </td>
                          )}
                          <td className="tally-numeric">
                            {r.points === r.max_points
                              ? r.points
                              : `${r.points}～${r.max_points}`}
                          </td>
                          {expandedColumns && (
                            <td className="tally-numeric">{r.total_points}</td>
                          )}
                        </tr>
                      ))}
                      {rankingRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={expandedColumns ? 8 : 5}
                            className="tally-empty"
                          >
                            {search
                              ? "検索条件に一致する作品はありません。"
                              : "この部門の投票データはありません。"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div
                className="table-scroll tally-table-scroll"
                role="region"
                aria-label="スコア表（横スクロール可能）"
                tabIndex={0}
              >
                <table className="tally-table tally-score-table">
                  <caption>
                    {result.year}年度 スコア計算（分母{result.score_denominator}
                    {result.provisional ? "・暫定" : ""}）
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">作品番号・作品名</th>
                      <th scope="col">製作者</th>
                      {tallyAwards.map((a) => (
                        <th scope="col" key={a.code}>
                          {a.name}順位
                        </th>
                      ))}
                      <th scope="col">受賞数（総合除く）</th>
                      <th scope="col" className="tally-numeric">
                        スコア
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoreRows.map((r) => (
                      <tr key={r.display_order}>
                        <td className="tally-work-cell">
                          <small>
                            No.{String(r.display_order).padStart(3, "0")}
                          </small>
                          <strong>{r.title}</strong>
                        </td>
                        <td>{r.author_name}</td>
                        {tallyAwards.map((a) => (
                          <td key={a.code}>{r.ranks[a.code] ?? "圏外"}</td>
                        ))}
                        <td>{r.award_count}</td>
                        <td className="tally-numeric tally-votes">
                          {r.score.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                    {scoreRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="tally-empty">
                          検索条件に一致する作品はありません。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <details className="tally-rules">
            <summary>
              <Info size={16} aria-hidden="true" />
              計算ルールと集計上の注意
            </summary>
            <p>
              投票明細から、Excelと同じ計算方法で得点・順位・スコアを再計算しています。
            </p>
            {result.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </details>
          {showDetails && (
            <section className="tally-details-card" aria-label="投票明細・感想">
              <h2>{result.year}年度の投票明細・感想</h2>
              <p>
                {result.source === "historical"
                  ? "過去フォーム原本（暫定）"
                  : "サイト確定票"}
                ：{result.details?.length ?? 0}
                明細（作品選択なしの感想を含む）。投票者情報・感想は運営者限定です。
              </p>
              <div className="admin-toolbar">
                <button
                  className="button secondary small"
                  disabled={detailPage === 0}
                  onClick={() => setDetailPage((p) => p - 1)}
                >
                  前の50明細
                </button>
                <span>
                  {detailPage + 1} /{" "}
                  {Math.max(1, Math.ceil((result.details?.length ?? 0) / 50))}
                  ページ
                </span>
                <button
                  className="button secondary small"
                  disabled={
                    (detailPage + 1) * 50 >= (result.details?.length ?? 0)
                  }
                  onClick={() => setDetailPage((p) => p + 1)}
                >
                  次の50明細
                </button>
              </div>
              <div className="table-scroll">
                <table>
                  <caption>
                    投票明細（全{result.details?.length ?? 0}件）
                  </caption>
                  <thead>
                    <tr>
                      <th>部門・作品</th>
                      <th>投票者</th>
                      <th>感想</th>
                      <th>投票日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.details
                      ?.slice(detailPage * 50, (detailPage + 1) * 50)
                      .map((d) => (
                        <tr key={d.id}>
                          <td>
                            {d.award_name}
                            <small>{d.title}</small>
                          </td>
                          <td>
                            {d.display_name}
                            <small>ID: {d.nico_user_id || "未記入"}</small>
                          </td>
                          <td className="comment-cell">
                            {d.comment || "（未入力）"}
                          </td>
                          <td>{jst(d.timestamp)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
