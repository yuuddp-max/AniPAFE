"use client";
import { useEffect, useState } from "react";
import type { AdminAuditRow } from "@/lib/admin-audit-types";
import { jst } from "@/lib/validation";

export function AdminAudit({ refreshToken }: { refreshToken: object }) {
  const [rows, setRows] = useState<AdminAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch("/api/admin/audit", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(40000),
          ]),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setRows(data);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refreshToken, retry]);
  if (loading) return <p role="status">操作履歴を読み込んでいます…</p>;
  if (error)
    return (
      <div>
        <p role="alert">{error}</p>
        <button onClick={() => setRetry((n) => n + 1)}>再読み込み</button>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>日時</th>
            <th>操作</th>
            <th>対象</th>
            <th>記録</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{jst(row.created_at)}</td>
              <td>{row.action}</td>
              <td>{row.target}</td>
              <td>{JSON.stringify(row.summary)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
