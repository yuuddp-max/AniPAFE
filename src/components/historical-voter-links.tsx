"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  HistoricalVoter,
  HistoricalVoterData,
} from "@/lib/historical-voter-types";
import { matchingNicoId } from "@/lib/historical-voter-types";
import { jst } from "@/lib/validation";

export function HistoricalVoterLinks({
  years,
  initialYear,
}: {
  years: number[];
  initialYear: number;
}) {
  const router = useRouter();
  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState<HistoricalVoterData | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<HistoricalVoter | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [reason, setReason] = useState("");
  const editorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (editing) editorHeading.current?.focus();
  }, [editing]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setEditing(null);
    setData(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/historical-voters?year=${year}`,
          { signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (!controller.signal.aborted) setData(payload);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [year, refresh]);

  const users = new Map(data?.users.map((user) => [user.user_id, user]));
  const needle = search.trim().toLocaleLowerCase();
  const voters = (data?.voters ?? []).filter((voter) => {
    const user = voter.user_id ? users.get(voter.user_id) : null;
    return (
      (filter === "all" ||
        (filter === "linked"
          ? voter.user_id !== null
          : voter.user_id === null)) &&
      [
        voter.display_name,
        voter.nico_user_id,
        String(voter.source_row),
        voter.id,
        user?.display_name,
        user?.nico_user_id,
        voter.user_id,
      ].some((value) => value?.toLocaleLowerCase().includes(needle))
    );
  });
  const pageCount = Math.max(1, Math.ceil(voters.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const candidateNeedle = userSearch.trim().toLocaleLowerCase();
  const candidates = (data?.users ?? [])
    .filter(
      (user) =>
        user.user_id === selectedUser ||
        [user.display_name, user.nico_user_id, user.user_id].some((value) =>
          value.toLocaleLowerCase().includes(candidateNeedle),
        ),
    )
    .toSorted(
      (a, b) =>
        Number(matchingNicoId(editing?.nico_user_id ?? null, b.nico_user_id)) -
          Number(
            matchingNicoId(editing?.nico_user_id ?? null, a.nico_user_id),
          ) || a.display_name.localeCompare(b.display_name),
    );
  const target = users.get(selectedUser);

  function edit(voter: HistoricalVoter) {
    setEditing(voter);
    setSelectedUser(voter.user_id ?? "");
    setUserSearch("");
    setReason("");
    setMessage("");
    setError("");
  }
  async function save(unlink: boolean) {
    if (!editing) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/historical-voters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          ballot_id: editing.id,
          user_id: unlink ? null : selectedUser,
          revision: editing.link_revision,
          reason,
        }),
        signal: AbortSignal.timeout(40000),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setMessage(
        `${year}年度：${unlink ? "紐付けを解除" : "紐付けを保存"}しました。`,
      );
      setEditing(null);
      setRefresh((value) => value + 1);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="admin-panel historical-links"
      aria-label="過去投票者の紐付け"
    >
      <div className="tally-heading">
        <h2>過去投票者の紐付け</h2>
        <button
          type="button"
          className="button secondary small"
          disabled={busy || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          再読み込み
        </button>
      </div>
      <p className="muted">
        過去フォーム原本の回答者とログインユーザーを、回答ごとに確認して紐付けます。原本の名前・ID・票、集計結果、本人の閲覧範囲は変わりません。
      </p>
      <div className="historical-link-filters">
        <label>
          紐付け年度
          <select
            aria-label="紐付け年度"
            value={year}
            disabled={busy}
            onChange={(event) => {
              setYear(Number(event.target.value));
              setPage(0);
              setMessage("");
            }}
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value}年度
              </option>
            ))}
          </select>
        </label>
        <label>
          原本・紐付け先を検索
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="名前・ニコニコID・回答行・ユーザーID"
          />
        </label>
        <label>
          紐付け状態
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">すべて</option>
            <option value="unlinked">未紐付け</option>
            <option value="linked">紐付け済み</option>
          </select>
        </label>
      </div>
      <p role="status">{loading ? "読み込み中…" : message}</p>
      {error && (
        <p role="alert" className="form-message">
          {error}
        </p>
      )}
      {editing && (
        <form
          className="historical-link-editor"
          aria-label="紐付けの編集"
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <h3 ref={editorHeading} tabIndex={-1}>
            原本：{editing.display_name}（回答行 {editing.source_row}）
          </h3>
          <p>原本ニコニコID：{editing.nico_user_id ?? "未記入"}</p>
          <p>
            現在の紐付け先：
            {editing.user_id
              ? `${users.get(editing.user_id)?.display_name ?? "不明"} / ${editing.user_id}`
              : "未紐付け"}
          </p>
          <label>
            ログインユーザーを検索
            <input
              type="search"
              value={userSearch}
              disabled={busy}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="名前・ニコニコID・ユーザーID"
            />
          </label>
          <label>
            紐付け先のログインユーザー
            <select
              value={selectedUser}
              disabled={busy}
              onChange={(event) => setSelectedUser(event.target.value)}
            >
              <option value="">ユーザーを選択してください</option>
              {candidates.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {matchingNicoId(editing.nico_user_id, user.nico_user_id)
                    ? "ID一致候補："
                    : ""}
                  {user.display_name} / ニコニコID {user.nico_user_id} /{" "}
                  {user.user_id}
                </option>
              ))}
            </select>
          </label>
          {candidates.length === 0 && (
            <p>該当するログインユーザーはいません。</p>
          )}
          <p className="muted">
            ニコニコIDが一致する候補を先に表示します。候補は自動確定されません。同一人物であることを確認してください。
          </p>
          {target && (
            <p>
              保存先：{target.display_name} / ニコニコID {target.nico_user_id}
              <br />
              <span className="historical-user-id">{target.user_id}</span>
            </p>
          )}
          <label>
            確認内容・変更理由
            <textarea
              value={reason}
              maxLength={500}
              required
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="historical-link-actions">
            <button
              className="button small"
              disabled={
                busy ||
                !target ||
                selectedUser === editing.user_id ||
                !reason.trim()
              }
            >
              紐付けを保存
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={busy || !editing.user_id || !reason.trim()}
              onClick={() => void save(true)}
            >
              紐付けを解除
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              キャンセル
            </button>
          </div>
        </form>
      )}
      {data && !loading && (
        <>
          <p>
            {year}年度：原本 {data.voters.length}件 ／ 紐付け済み{" "}
            {data.voters.filter((voter) => voter.user_id).length}件 ／ 表示対象{" "}
            {voters.length}件
          </p>
          {data.voters.length === 0 ? (
            <p>この年度の過去フォーム原本はありません。</p>
          ) : voters.length === 0 ? (
            <p>検索条件に一致する回答はありません。</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>回答行・原本日時</th>
                    <th>原本の投票者</th>
                    <th>紐付け先</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {voters
                    .slice(currentPage * 50, (currentPage + 1) * 50)
                    .map((voter) => {
                      const user = voter.user_id
                        ? users.get(voter.user_id)
                        : null;
                      return (
                        <tr key={voter.id}>
                          <td data-label="回答行・原本日時">
                            <div>
                              {voter.source_row}
                              <br />
                              {voter.source_timestamp}
                            </div>
                          </td>
                          <td data-label="原本の投票者">
                            <div>
                              {voter.display_name}
                              <br />
                              ニコニコID：{voter.nico_user_id ?? "未記入"}
                            </div>
                          </td>
                          <td data-label="紐付け先">
                            <div>
                              {user ? (
                                <>
                                  {user.display_name}
                                  <br />
                                  ニコニコID：{user.nico_user_id}
                                  <br />
                                  <span className="historical-user-id">
                                    {user.user_id}
                                  </span>
                                  <br />
                                  {voter.linked_at ? jst(voter.linked_at) : ""}
                                </>
                              ) : (
                                "未紐付け"
                              )}
                            </div>
                          </td>
                          <td data-label="操作">
                            <button
                              type="button"
                              className="button secondary small"
                              disabled={busy}
                              onClick={() => edit(voter)}
                            >
                              紐付けを編集
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          {voters.length > 50 && (
            <div
              className="historical-link-actions"
              aria-label="回答のページ切替"
            >
              <button
                type="button"
                className="button secondary small"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                前の50件
              </button>
              <span>
                {currentPage + 1} / {pageCount}ページ
              </span>
              <button
                type="button"
                className="button secondary small"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                次の50件
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
