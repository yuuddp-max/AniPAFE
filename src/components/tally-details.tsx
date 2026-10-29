"use client";
import { useEffect, useState } from "react";
import type { AdminTallyResult, TallyDetail } from "@/lib/tally";
import { jst } from "@/lib/validation";

export function TallyDetails({ result }: { result: AdminTallyResult }) {
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    page: number;
    details: TallyDetail[];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const total = result.detail_count ?? 0;
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
          setLoaded({ page, details: data.details });
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [result, page, attempt]);
  return (
    <div aria-busy={busy}>
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
          {total === 0 && <p>投票明細はありません。</p>}
        </div>
      )}
    </div>
  );
}
