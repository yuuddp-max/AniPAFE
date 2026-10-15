"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChartColumn,
  Clapperboard,
  History,
  UsersRound,
} from "lucide-react";
import type { AdminYearData, Poll } from "@/lib/types";
import { AdminYearWorkspace } from "@/components/admin-year-workspace";
import { jst } from "@/lib/validation";
import { TallyPanel } from "@/components/tally-panel";
import type { AdminTallyResult } from "@/lib/tally";
const adminTabs = [
  {
    key: "settings",
    label: "年度・投票設定",
    description: "対象年度・期間・公開",
    icon: CalendarDays,
  },
  {
    key: "ranking",
    label: "集計・明細",
    description: "順位・明細・出力",
    icon: ChartColumn,
  },
  {
    key: "videos",
    label: "作品マスター",
    description: "作品登録・編集",
    icon: Clapperboard,
  },
  {
    key: "voters",
    label: "投票者・修正",
    description: "投票確認・訂正",
    icon: UsersRound,
  },
  {
    key: "audit",
    label: "操作履歴",
    description: "変更記録を確認",
    icon: History,
  },
] as const;
export function AdminDashboard({
  report,
  initialTally,
  poll,
  years,
  initialVideos,
  initialVoters,
  audit,
}: {
  initialTally: AdminTallyResult;
  report: {
    stats: Record<string, number>;
  };
  poll: Poll;
  years: Poll[];
  initialVideos: AdminYearData;
  initialVoters: AdminYearData;
  audit: {
    id: number;
    action: string;
    target: string | null;
    created_at: string;
    summary: Record<string, unknown>;
  }[];
}) {
  const router = useRouter(),
    [tab, setTab] = useState("ranking"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
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
    );
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
  return (
    <>
      <header className="admin-dashboard-heading">
        <div>
          <span className="eyebrow">ORGANIZER DASHBOARD</span>
          <h1>運営管理</h1>
        </div>
        <span className="admin-private-label">運営者限定</span>
      </header>
      <details className="admin-registration">
        <summary>
          {poll.year}年度の登録状況
          <span>
            有効作品 {report.stats.videos}件 · Google登録者{" "}
            {report.stats.google_users}人
          </span>
        </summary>
        <div className="admin-stats">
          {[
            ["videos", "有効作品"],
            ["themed", "テーマ対象"],
            ["google_users", "Google登録者"],
            ["drafts", "サイト下書き"],
            ["submitted", "サイト確定投票者"],
            ["historical_ballots", "過去フォーム回答"],
            ["historical_votes", "過去フォーム票数"],
          ].map(([key, label]) => (
            <div key={key}>
              <span>{label}</span>
              <strong>
                {key === "historical_ballots"
                  ? initialTally.historical_ballot_count
                  : key === "historical_votes"
                    ? initialTally.historical_selection_count
                    : report.stats[key]}
              </strong>
            </div>
          ))}
        </div>
        <p className="muted">
          過去フォームは暫定集計、サイト投票は確定済みのみを集計します。
        </p>
      </details>
      <nav className="admin-tabs" aria-label="管理機能">
        {adminTabs.map(({ key, label, description, icon: Icon }) => (
          <button
            type="button"
            id={`admin-tab-${key}`}
            aria-label={label}
            aria-describedby={`admin-tab-description-${key}`}
            aria-controls={`admin-panel-${key}`}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            key={key}
          >
            <span className="admin-tab-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.8} />
            </span>
            <span className="admin-tab-copy">
              <span className="admin-tab-label">{label}</span>
              <span
                className="admin-tab-description"
                id={`admin-tab-description-${key}`}
              >
                {description}
              </span>
            </span>
          </button>
        ))}
      </nav>
      <p role="status" className="form-message">
        {message}
      </p>
      <div id="admin-panel-ranking" hidden={tab !== "ranking"}>
        <TallyPanel
          years={years.map((y) => y.year)}
          initialResult={initialTally}
          showDetails
        />
      </div>
      <div id="admin-panel-videos" hidden={tab !== "videos"}>
        <AdminYearWorkspace years={years} initialData={initialVideos} />
      </div>
      <div id="admin-panel-settings" hidden={tab !== "settings"}>
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
      </div>
      <div id="admin-panel-voters" hidden={tab !== "voters"}>
        <AdminYearWorkspace years={years} initialData={initialVoters} />
      </div>
      <div id="admin-panel-audit" hidden={tab !== "audit"}>
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
      </div>
    </>
  );
}
function localDate(iso: string | null) {
  if (!iso) return "";
  return new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 16);
}
