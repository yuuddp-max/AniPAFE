"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Ballot, Poll, Profile, Video } from "@/lib/types";
import { jst } from "@/lib/validation";
import { TallyPanel } from "@/components/tally-panel";
import type { TallyResult } from "@/lib/tally";
type Ranking = {
  award_code: string;
  award_name: string;
  video_id: string;
  title: string;
  author_name: string;
  votes: number;
  rank: number;
};
type Detail = {
  award_name: string;
  video_id: string;
  title: string;
  display_name: string;
  nico_user_id: string;
  comment: string;
  submitted_at: string;
};
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
export function AdminDashboard({
  report,
  initialTally,
  poll,
  years,
  videos,
  profiles,
  ballots,
  audit,
}: {
  initialTally: TallyResult;
  report: {
    stats: Record<string, number>;
    rankings: Ranking[];
    details: Detail[];
  };
  poll: Poll;
  years: Poll[];
  videos: Video[];
  profiles: Profile[];
  ballots: Ballot[];
  audit: {
    id: number;
    action: string;
    target: string | null;
    created_at: string;
    summary: Record<string, unknown>;
  }[];
}) {
  const router = useRouter(),
    [tab, setTab] = useState("excel"),
    [award, setAward] = useState("overall"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<Preview | null>(null);
  const [start, setStart] = useState(localDate(poll.starts_at)),
    [end, setEnd] = useState(localDate(poll.ends_at)),
    [published, setPublished] = useState(poll.is_published),
    [title, setTitle] = useState(poll.title),
    [resultsPublic, setResultsPublic] = useState(poll.results_public),
    [targetYear, setTargetYear] = useState(poll.year),
    [newYear, setNewYear] = useState(
      Math.min(2100, Math.max(...years.map((y) => y.year)) + 1),
    ),
    [newTitle, setNewTitle] = useState(
      `AniPAFE${Math.min(2100, Math.max(...years.map((y) => y.year)) + 1)} 人気投票`,
    ),
    [query, setQuery] = useState("");
  async function action(body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(body as Record<string, unknown>),
          year: poll.year,
        }),
        signal: AbortSignal.timeout(40000),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setMessage("保存しました。");
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(confirm = false) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("year", String(poll.year));
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
    <>
      <span className="eyebrow">ORGANIZER DASHBOARD</span>
      <h1>運営管理</h1>
      <section className="admin-year-bar" aria-label="対象年度の管理">
        <div>
          <strong>対象年度：{poll.year}年度</strong>
          <p className="muted">{poll.title}</p>
        </div>
        <label>
          対象年度
          <select
            aria-label="対象年度"
            value={targetYear}
            onChange={(e) => setTargetYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}年度
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary small"
          disabled={busy || targetYear === poll.year}
          onClick={() => {
            if (
              window.confirm(
                `${targetYear}年度に切り替えます。投票画面と管理対象が変わります。既存の投票は保持されます。`,
              )
            )
              void action({ action: "switch_year", target_year: targetYear });
          }}
        >
          対象年度を切り替え
        </button>
        <details className="year-create">
          <summary>新しい年度を追加</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action({
                action: "create_year",
                new_year: newYear,
                title: newTitle,
              });
            }}
          >
            <label>
              追加する年度
              <input
                type="number"
                min={2000}
                max={2100}
                value={newYear}
                required
                onChange={(e) => {
                  setNewYear(Number(e.target.value));
                  setNewTitle(`AniPAFE${e.target.value} 人気投票`);
                }}
              />
            </label>
            <label>
              新年度の投票画面タイトル
              <input
                maxLength={100}
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
            <p>
              新年度は作品未登録・受付OFF・結果非公開で作成します。追加後に対象年度を切り替え、作品を取り込んでください。
            </p>
            <button className="button small" disabled={busy}>
              年度を追加
            </button>
          </form>
        </details>
      </section>
      <p className="muted">
        {tab === "excel"
          ? "集計結果は運営者限定です。過去フォームの集計は暫定として表示します。"
          : "集計対象は確定済み投票のみ。明細・感想は運営者限定です。"}
      </p>
      <div className="admin-stats">
        {[
          ["videos", "有効作品"],
          ["themed", "テーマ対象"],
          ["google_users", "Google登録者"],
          ["drafts", "下書き"],
          ["submitted", "確定投票者"],
        ].map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{report.stats[key]}</strong>
          </div>
        ))}
      </div>
      <nav className="admin-tabs" aria-label="管理機能">
        {[
          ["excel", "集計結果"],
          ["ranking", "集計・明細"],
          ["videos", "作品マスター"],
          ["settings", "年度・投票設定"],
          ["voters", "投票者・修正"],
          ["audit", "操作履歴"],
        ].map(([key, label]) => (
          <button
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            key={key}
          >
            {label}
          </button>
        ))}
      </nav>
      <p role="status" className="form-message">
        {message}
      </p>
      {tab === "ranking" && (
        <>
          <div className="admin-toolbar">
            <select
              aria-label="集計部門"
              value={award}
              onChange={(e) => setAward(e.target.value)}
            >
              {Array.from(
                new Map(
                  report.rankings.map((r) => [r.award_code, r.award_name]),
                ).entries(),
              ).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <a
              className="button secondary small"
              href={`/api/admin/export?type=ranking&year=${poll.year}`}
            >
              ランキングCSV ↓
            </a>
            <a
              className="button secondary small"
              href={`/api/admin/export?type=details&year=${poll.year}`}
            >
              投票明細CSV ↓
            </a>
          </div>
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
                {report.rankings
                  .filter((r) => r.award_code === award)
                  .map((r) => (
                    <tr key={r.video_id}>
                      <td>{r.rank}</td>
                      <td>
                        {r.title}
                        <small>{r.video_id}</small>
                      </td>
                      <td>{r.author_name}</td>
                      <td>{r.votes}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <h2>確定済み投票の感想・明細</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>部門・作品</th>
                  <th>投票者</th>
                  <th>感想</th>
                  <th>確定日時</th>
                </tr>
              </thead>
              <tbody>
                {report.details.map((d, i) => (
                  <tr key={i}>
                    <td>
                      {d.award_name}
                      <small>{d.title}</small>
                    </td>
                    <td>
                      {d.display_name}
                      <small>ID: {d.nico_user_id}</small>
                    </td>
                    <td className="comment-cell">
                      {d.comment || "（未入力）"}
                    </td>
                    <td>{jst(d.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "excel" && (
        <TallyPanel
          years={years.map((y) => y.year)}
          initialResult={initialTally}
        />
      )}
      {tab === "videos" && (
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
                {videos
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
                                master_revision: poll.master_revision,
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
                                master_revision: poll.master_revision,
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
      {tab === "settings" && (
        <form
          className="admin-panel profile-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (window.confirm("投票期間・公開状態を更新しますか？"))
              void action({
                action: "settings",
                starts_at: start
                  ? new Date(`${start}:00+09:00`).toISOString()
                  : null,
                ends_at: end ? new Date(`${end}:00+09:00`).toISOString() : null,
                is_published: published,
                title,
                results_public: resultsPublic,
              });
          }}
        >
          <h2>{poll.year}年度の投票設定</h2>
          <label>
            投票画面タイトル
            <input
              value={title}
              maxLength={100}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <p className="muted">
            この年度の投票画面・ブラウザータイトルに反映されます。日時は日本時間（Asia/Tokyo）です。
          </p>
          <label>
            開始日時
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required={published}
            />
          </label>
          <label>
            終了日時
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required={published}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
            />
            期間内の投票受付を有効にする
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={resultsPublic}
              onChange={(e) => setResultsPublic(e.target.checked)}
            />
            終了後の投票結果を過去投票データに公開する
          </label>
          <p>
            未設定・受付OFFの場合は保存・確定を許可しません。公開されるのは部門別の順位・得票数のみです。投票者名・個別の感想は公開しません。
          </p>
          <button className="button" disabled={busy}>
            設定を保存
          </button>
        </form>
      )}
      {tab === "voters" && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>投票者</th>
                <th>認証ID</th>
                <th>状態</th>
                <th>運営による修正</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const b = ballots.find((b) => b.voter_id === p.user_id);
                return (
                  <tr key={p.user_id}>
                    <td>
                      {p.display_name}
                      <small>ニコニコID: {p.nico_user_id}</small>
                    </td>
                    <td>{p.user_id}</td>
                    <td>{b?.status === "submitted" ? "確定済み" : "下書き"}</td>
                    <td>
                      <button
                        disabled={busy || b?.status !== "submitted"}
                        onClick={() => {
                          const reason =
                            window.prompt("再開理由（操作履歴に記録）");
                          if (reason)
                            void action({
                              action: "reopen",
                              voter_id: p.user_id,
                              reason,
                            });
                        }}
                      >
                        投票を再開
                      </button>
                      <button
                        disabled={busy || b?.status === "submitted"}
                        onClick={() => {
                          const nico = window.prompt(
                            "正しいニコニコユーザーID",
                            p.nico_user_id,
                          );
                          if (!nico) return;
                          const reason =
                            window.prompt(
                              "修正理由（自薦になった下書きは削除）",
                            );
                          if (reason)
                            void action({
                              action: "profile",
                              voter_id: p.user_id,
                              nico_user_id: nico,
                              reason,
                            });
                        }}
                      >
                        IDを訂正
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tab === "audit" && (
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
              {audit.map((a) => (
                <tr key={a.id}>
                  <td>{jst(a.created_at)}</td>
                  <td>{a.action}</td>
                  <td>{a.target}</td>
                  <td>{JSON.stringify(a.summary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
function localDate(iso: string | null) {
  if (!iso) return "";
  return new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 16);
}
