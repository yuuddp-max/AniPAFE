"use client";
import { useEffect, useState } from "react";
import type { AdminTallyResult, TallyDetail } from "@/lib/tally";
import { tallyAwards } from "@/lib/tally";
import { jst } from "@/lib/validation";

export function TallyDetails({
  result,
  workNumber,
}: {
  result: AdminTallyResult;
  workNumber?: number;
}) {
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const emptyFilters = { q: "", award: "", comments_only: "0" };
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [loaded, setLoaded] = useState<{
    page: number;
    details: TallyDetail[];
    total: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const total = loaded?.total ?? 0;
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setLoaded(null);
    const query = new URLSearchParams({
      year: String(result.year),
      source: result.source,
      denominator: String(result.score_denominator),
      format: "detail-page",
      page: String(page),
      calculated_at: result.calculated_at!,
      ...filters,
      ...(workNumber ? { work_number: String(workNumber) } : {}),
    });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/tally?${query}`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(40000),
          ]),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted)
          setLoaded({ page, details: data.details, total: data.total });
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [result, page, attempt, filters, workNumber]);
  return (
    <div aria-busy={busy}>
      <form
        className="admin-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setLoaded(null);
          setBusy(true);
          setPage(0);
          setFilters({ ...draft, q: draft.q.trim() });
        }}
      >
        <label>
          明細を検索
          <input
            type="search"
            maxLength={200}
            value={draft.q}
            placeholder="作品名・投票者名・ニコニコID・感想"
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
        </label>
        <label>
          明細の部門
          <select
            aria-label="明細の部門"
            value={draft.award}
            onChange={(event) =>
              setDraft({ ...draft, award: event.target.value })
            }
          >
            <option value="">すべての部門</option>
            {tallyAwards.map((award) => (
              <option key={award.code} value={award.code}>
                {award.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.comments_only === "1"}
            onChange={(event) =>
              setDraft({
                ...draft,
                comments_only: event.target.checked ? "1" : "0",
              })
            }
          />
          感想ありのみ
        </label>
        <button className="button secondary small" type="submit">
          検索
        </button>
        <button
          className="button secondary small"
          type="button"
          onClick={() => {
            setDraft(emptyFilters);
            setFilters(emptyFilters);
            setPage(0);
            setLoaded(null);
            setBusy(true);
          }}
        >
          検索条件をクリア
        </button>
      </form>
      {loaded && !busy && !error && (
        <p role="status">
          検索結果：{total}件（全{result.detail_count ?? 0}明細）
        </p>
      )}
      <div className="admin-toolbar">
        <button
          className="button secondary small"
          disabled={page === 0 || busy}
          onClick={() => setPage((p) => p - 1)}
        >
          前の50明細
        </button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(total / 50))}ページ
        </span>
        <button
          className="button secondary small"
          disabled={(page + 1) * 50 >= total || busy}
          onClick={() => setPage((p) => p + 1)}
        >
          次の50明細
        </button>
      </div>
      {busy && <p role="status">投票明細を読み込んでいます…</p>}
      {error && (
        <div>
          <p role="alert" className="error">
            {error}
          </p>
          <button
            className="button secondary small"
            onClick={() => setAttempt((n) => n + 1)}
          >
            明細を再読み込み
          </button>
        </div>
      )}
      {loaded?.page === page && !busy && !error && (
        <div className="table-scroll">
          <table>
            <caption>投票明細（全{total}件）</caption>
            <thead>
              <tr>
                <th>部門・作品</th>
                <th>投票者</th>
                <th>感想</th>
                <th>投票日時</th>
              </tr>
            </thead>
            <tbody>
              {loaded.details.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.award_name}
                    <small>{d.title}</small>
                  </td>
                  <td>
                    {d.display_name}
                    <small>ID: {d.nico_user_id || "未記入"}</small>
                  </td>
                  <td className="comment-cell">{d.comment || "（未入力）"}</td>
                  <td>{jst(d.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total === 0 && <p>条件に一致する投票明細はありません。</p>}
        </div>
      )}
    </div>
  );
}
