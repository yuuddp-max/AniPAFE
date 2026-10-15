"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminYearData, Poll } from "@/lib/types";
type Preview = {
  token: string;
  active: number;
  themed: number;
  excluded: number;
  errors: { row: number; reason: string }[];
  diff: {
    video_id: string;
    title: string;
    change: string;
    fields: string[];
    referencing: number;
    invalid_drafts: number;
    invalid_submitted: number;
  }[];
};

export function AdminYearWorkspace({
  years,
  initialData,
}: {
  years: Poll[];
  initialData: AdminYearData;
}) {
  const router = useRouter();
  const kind = initialData.kind;
  const label = kind === "videos" ? "作品マスター" : "投票者・修正";
  const [year, setYear] = useState(initialData.year);
  const [data, setData] = useState<AdminYearData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    setData((previous) =>
      previous?.year === initialData.year ? initialData : previous,
    );
  }, [initialData]);
  async function load(nextYear: number) {
    const id = ++requestId.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setYear(nextYear);
    setData(null);
    setLoading(true);
    setError("");
    setPreview(null);
    setFile(null);
    try {
      const response = await fetch(
        "/api/admin/year-data?year=" + nextYear + "&kind=" + kind,
        { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(40000)]) },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (id === requestId.current) setData(result);
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }
  async function action(body: Record<string, unknown>) {
    if (!data) return;
    const year = data.year;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, year }),
        signal: AbortSignal.timeout(40000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await load(year);
      setMessage(year + "年度：保存しました。");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(confirm = false) {
    if (!file || !data) return;
    const year = data.year;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("year", String(year));
      if (confirm && preview) {
        form.set("confirm", "true");
        form.set("token", preview.token);
      }
      const res = await fetch("/api/admin/import", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(40000),
        }),
        d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (confirm) {
        setPreview(null);
        await load(year);
        setMessage(
          `取込完了：追加${d.result.inserted}・更新${d.result.updated}・不正下書き削除${d.result.removed_drafts}件`,
        );
        router.refresh();
      } else setPreview(d);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="admin-year-workspace"
      aria-label={label + "の年度別管理"}
      aria-busy={loading || busy}
    >
      <div className="admin-panel admin-workspace-heading">
        <h2>
          {year}年度の{label}
        </h2>
        <label>
          {label}年度
          <select
            aria-label={label + "年度"}
            value={year}
            disabled={busy}
            onChange={(e) => {
              setMessage("");
              setQuery("");
              void load(Number(e.target.value));
            }}
          >
            {years.map((p) => (
              <option key={p.year} value={p.year}>
                {p.year}年度
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          上部の対象年度を変えずに、選んだ年度の
          {kind === "videos" ? "作品を表示・編集" : "投票者を表示・修正"}
          できます。
        </p>
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && <p role="status">{year}年度のデータを読み込んでいます…</p>}
      {!loading && !data && (
        <button onClick={() => void load(year)}>再読み込み</button>
      )}
      {data?.kind === "videos" && (
        <>
          <section className="admin-panel">
            <h2>CSV / Excel再インポート</h2>
            <p>
              差分と投票への影響を確認してから反映します。ファイルにない作品は保持します。非公開化は作品ごとに設定してください。
            </p>
            <input
              aria-label="インポートファイル"
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
            <button
              className="button small"
              disabled={!file || busy}
              onClick={() => void upload()}
            >
              差分をプレビュー
            </button>
            {preview && (
              <>
                <p>
                  対象{preview.active}件 / テーマ{preview.themed}件 / 除外
                  {preview.excluded}件 / エラー{preview.errors.length}件
                </p>
                {preview.errors.map((e) => (
                  <p className="error" key={e.row}>
                    行{e.row}：{e.reason}
                  </p>
                ))}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>作品</th>
                        <th>変更</th>
                        <th>参照票</th>
                        <th>削除予定下書き</th>
                        <th>不正になる確定票</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.diff
                        .filter((d) => d.change !== "変更なし")
                        .map((d) => (
                          <tr key={d.video_id}>
                            <td>
                              {d.title}
                              <small>{d.video_id}</small>
                            </td>
                            <td>
                              {d.change} {d.fields.join(", ")}
                            </td>
                            <td>{d.referencing}</td>
                            <td>{d.invalid_drafts}</td>
                            <td>{d.invalid_submitted}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="button"
                  disabled={
                    busy ||
                    !!preview.errors.length ||
                    preview.diff.some((d) => d.invalid_submitted > 0)
                  }
                  onClick={() => {
                    if (window.confirm("表示した差分を反映しますか？"))
                      void upload(true);
                  }}
                >
                  この差分を反映する
                </button>
              </>
            )}
          </section>
          <input
            className="admin-search"
            placeholder="作品名・動画IDで検索"
            aria-label="作品マスター検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>作品</th>
                  <th>状態・テーマ</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.videos
                  .filter((v) => `${v.title} ${v.video_id}`.includes(query))
                  .map((v) => (
                    <tr key={v.video_id}>
                      <td>
                        {v.title}
                        <small>
                          {v.video_id} / {v.author_name}
                        </small>
                      </td>
                      <td>
                        {v.is_active ? "有効" : "非公開"}
                        <small>{v.theme || "テーマ未入力"}</small>
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          onClick={() => {
                            const theme = window.prompt(
                              "テーマ（空欄で未入力）",
                              v.theme ?? "",
                            );
                            if (
                              theme !== null &&
                              window.confirm(
                                "テーマを更新します。確定済み投票が不正になる場合は拒否されます。",
                              )
                            )
                              void action({
                                action: "video",
                                video_id: v.video_id,
                                theme,
                                is_active: v.is_active,
                                master_revision: data.master_revision,
                              });
                          }}
                        >
                          テーマ編集
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `${v.is_active ? "非公開" : "有効"}に変更しますか？確定票への影響はDBで確認します。`,
                              )
                            )
                              void action({
                                action: "video",
                                video_id: v.video_id,
                                theme: v.theme,
                                is_active: !v.is_active,
                                master_revision: data.master_revision,
                              });
                          }}
                        >
                          {v.is_active ? "非公開にする" : "有効にする"}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action({
                              action: "thumbnail",
                              video_id: v.video_id,
                            })
                          }
                        >
                          サムネイル再取得
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {data?.kind === "voters" && (
        <>
          <p className="muted">
            この年度に投票データがある方を表示します。過去フォーム原本は閲覧のみです。
          </p>
          <p className="muted">
            ニコニコIDは全年度共通です。ID訂正は全年度のプロフィールに反映されます。確定済み投票がある年度は先に再開してください。
          </p>
          <div className="table-scroll">
            <table>
              <caption>
                {data.year}年度の投票者・修正（{data.voters.length}件）
              </caption>
              <thead>
                <tr>
                  <th>投票者</th>
                  <th>認証ID</th>
                  <th>状態</th>
                  <th>運営による修正</th>
                </tr>
              </thead>
              <tbody>
                {data.voters.map((v) => (
                  <tr key={v.ballot_id}>
                    <td>
                      {v.display_name}
                      <small>ニコニコID: {v.nico_user_id || "未記入"}</small>
                    </td>
                    <td>{v.voter_id ?? "過去フォーム原本"}</td>
                    <td>
                      {v.source === "historical"
                        ? "取込済み（原本）"
                        : v.status === "submitted"
                          ? "確定済み"
                          : "下書き"}
                    </td>
                    <td>
                      {v.source === "site" && v.voter_id ? (
                        <>
                          <button
                            disabled={busy || v.status !== "submitted"}
                            onClick={() => {
                              const reason = window.prompt(
                                data.year + "年度の再開理由（操作履歴に記録）",
                              );
                              if (reason)
                                void action({
                                  action: "reopen",
                                  voter_id: v.voter_id,
                                  reason,
                                });
                            }}
                          >
                            投票を再開
                          </button>
                          <button
                            disabled={busy || v.status === "submitted"}
                            onClick={() => {
                              const nico = window.prompt(
                                "正しいニコニコユーザーID（全年度共通）",
                                v.nico_user_id,
                              );
                              if (!nico) return;
                              const reason = window.prompt(
                                "修正理由（全年度の自薦になった下書きは削除）",
                              );
                              if (reason)
                                void action({
                                  action: "profile",
                                  voter_id: v.voter_id,
                                  nico_user_id: nico,
                                  reason,
                                });
                            }}
                          >
                            IDを訂正
                          </button>
                        </>
                      ) : (
                        "原本のため修正不可"
                      )}
                    </td>
                  </tr>
                ))}
                {data.voters.length === 0 && (
                  <tr>
                    <td colSpan={4}>この年度の投票者はいません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
