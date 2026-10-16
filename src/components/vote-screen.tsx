"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVotes } from "./vote-provider";
import { Player } from "./player";
import { VideoImage } from "./video-image";
import { OtherAwards } from "./other-awards";
import { pollIsOpen } from "@/lib/validation";
import type { AwardCode, Video } from "@/lib/types";
import { isOriginalSelection } from "@/lib/original-votes";
const PAGE_SIZE = 12;
export function VoteScreen({ code }: { code: AwardCode }) {
  const { data, entries, change, submitted, original } = useVotes(),
    award = data.awards.find((a) => a.code === code)!;
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("order"),
    [page, setPage] = useState(1),
    [slideDirection, setSlideDirection] = useState<"next" | "previous">("next"),
    [player, setPlayer] = useState<Video | null>(null),
    [now, setNow] = useState(Date.now());
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const displayedEntries = original?.entries ?? entries,
    originalEntries =
      original?.entries.filter((e) => e.award_code === code) ?? [],
    selected = entries.filter((e) => e.award_code === code),
    selectedCount = original
      ? originalEntries.filter(isOriginalSelection).length
      : selected.length,
    selectedIds = new Set(
      displayedEntries
        .filter((e) => e.award_code === code)
        .map((e) => e.video_id),
    ),
    overLimit = !original && selectedCount > award.max_votes,
    open = pollIsOpen(data.poll, now),
    disabled = !!original || submitted || !open;
  const videoMap = useMemo(
    () => new Map(data.videos.map((v) => [v.video_id, v])),
    [data.videos],
  );
  const otherAwardsByVideo = useMemo(() => {
    const selectedByVideo = new Map<string, Set<AwardCode>>();
    for (const entry of displayedEntries) {
      if (entry.award_code === code || !entry.video_id) continue;
      const codes = selectedByVideo.get(entry.video_id) ?? new Set<AwardCode>();
      codes.add(entry.award_code);
      selectedByVideo.set(entry.video_id, codes);
    }
    return new Map(
      [...selectedByVideo].map(([videoId, codes]) => [
        videoId,
        data.awards
          .filter((award) => codes.has(award.code))
          .sort((a, b) => a.display_order - b.display_order),
      ]),
    );
  }, [displayedEntries, code, data.awards]);
  const videos = useMemo(
    () =>
      data.videos
        .filter(
          (v) =>
            (code !== "theme" || !!v.theme) &&
            (!query ||
              `${v.title} ${v.author_name} ${v.video_id}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase())) &&
            (filter !== "theme" || !!v.theme) &&
            (filter !== "selected" ||
              displayedEntries.some(
                (e) => e.award_code === code && e.video_id === v.video_id,
              )),
        )
        .sort((a, b) =>
          sort === "newest"
            ? (b.posted_at ?? "").localeCompare(a.posted_at ?? "") ||
              a.display_order - b.display_order
            : sort === "author"
              ? a.author_name.localeCompare(b.author_name, "ja")
              : a.display_order - b.display_order,
        ),
    [data.videos, code, query, filter, sort, displayedEntries],
  );
  const maxPage = Math.max(1, Math.ceil(videos.length / PAGE_SIZE)),
    actualPage = Math.min(page, maxPage);
  function changePage(next: number) {
    if (next < 1 || next > maxPage || next === actualPage) return;
    setSlideDirection(next > actualPage ? "next" : "previous");
    setPage(next);
  }
  function removeSelection(videoId: string) {
    if (disabled) return;
    const entry = selected.find((e) => e.video_id === videoId);
    if (!entry) return;
    if (
      entry.comment.length > 0 &&
      !window.confirm(
        `「${videoMap.get(videoId)?.title ?? videoId}」の選択を解除すると、入力済みの感想も削除されます。選択を解除しますか？`,
      )
    )
      return;
    change(
      entries.filter((e) => !(e.award_code === code && e.video_id === videoId)),
    );
  }
  function toggle(v: Video) {
    if (disabled) return;
    if (selectedIds.has(v.video_id)) removeSelection(v.video_id);
    else if (v.author_nico_user_id !== data.profile.nico_user_id)
      change([
        ...entries,
        { award_code: code, video_id: v.video_id, comment: "" },
      ]);
  }
  return (
    <main id="main" className="vote-main">
      {original ? (
        <div className="notice">
          過去フォーム原本の選択作品と感想を表示しています。原本は閲覧専用です。
        </div>
      ) : (
        !open &&
        !submitted && (
          <div className="notice" role="status">
            現在は投票期間外です。作品と保存済みの内容を確認できますが、選択・保存・確定はできません。
          </div>
        )
      )}
      <div className="workspace">
        <section className="catalog">
          <div className="catalog-heading">
            <div>
              <span className="eyebrow">0{award.display_order} / 06</span>
              <h2>
                {award.name}
                <span>
                  {award.min_votes}～{award.max_votes}作品
                </span>
              </h2>
            </div>
            <span className="catalog-total">
              {code === "theme" ? "テーマ記入済み " : ""}
              {videos.length}作品
            </span>
          </div>
          {code === "theme" && (
            <p className="theme-intro">
              作品に込められたテーマへ。テーマが記入された作品だけが対象です。
            </p>
          )}
          <div className="search-row">
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="作品を検索"
                placeholder="作品名・投稿者名・動画IDで検索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="sr-only" htmlFor="filter">
              絞り込み
            </label>
            <select
              id="filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">すべて</option>
              <option value="selected">選択中の作品</option>
              {code !== "theme" && <option value="theme">テーマあり</option>}
            </select>
            <label className="sr-only" htmlFor="sort">
              並び替え
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="order">作品No.順</option>
              <option value="newest">投稿日順</option>
              <option value="author">投稿者名順</option>
            </select>
          </div>
          <div className="catalog-page-summary">
            <span aria-live="polite" aria-atomic="true">
              作品ページ {actualPage} / {maxPage}
            </span>
            <small>左右の矢印・スワイプでページ切替</small>
          </div>
          <div className="catalog-slider">
            <nav className="catalog-page-controls" aria-label="作品ページ">
              <button
                aria-label="前の作品ページ"
                title="前の作品ページ"
                disabled={actualPage <= 1}
                onClick={() => changePage(actualPage - 1)}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <button
                aria-label="次の作品ページ"
                title="次の作品ページ"
                disabled={actualPage >= maxPage}
                onClick={() => changePage(actualPage + 1)}
              >
                <span aria-hidden="true">›</span>
              </button>
            </nav>
            <div
              className="catalog-slide-viewport"
              onTouchStart={(event) => {
                const target = event.target as HTMLElement;
                const touch = event.touches[0];
                swipeStart.current =
                  event.touches.length === 1 &&
                  !target.closest("button, a, input, textarea, select")
                    ? { x: touch.clientX, y: touch.clientY }
                    : null;
              }}
              onTouchCancel={() => {
                swipeStart.current = null;
              }}
              onTouchEnd={(event) => {
                const start = swipeStart.current;
                swipeStart.current = null;
                const touch = event.changedTouches[0];
                if (!start || !touch) return;
                const dx = touch.clientX - start.x,
                  dy = touch.clientY - start.y;
                if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
                  changePage(actualPage + (dx < 0 ? 1 : -1));
              }}
            >
              <div
                key={`${actualPage}-${query}-${filter}-${sort}`}
                className={`video-grid slide-${slideDirection}${overLimit ? " over-limit" : ""}`}
              >
                {videos
                  .slice((actualPage - 1) * PAGE_SIZE, actualPage * PAGE_SIZE)
                  .map((v) => {
                    const own =
                        !original &&
                        v.author_nico_user_id === data.profile.nico_user_id,
                      chosen = selectedIds.has(v.video_id);
                    return (
                      <article
                        className={`video-card ${chosen ? "chosen" : ""} ${own ? "own" : ""}`}
                        key={v.video_id}
                      >
                        <div className="card-media">
                          <VideoImage
                            url={v.thumbnail_url}
                            title={v.title}
                            order={v.display_order}
                          />
                          <button
                            className="play-button"
                            aria-label={`${v.title}を再生`}
                            onClick={() => setPlayer(v)}
                          >
                            <span aria-hidden="true">▶</span> 再生
                          </button>
                          {chosen && (
                            <span className="chosen-badge">✓ 選択中</span>
                          )}
                        </div>
                        <div className="card-body">
                          <h3>{v.title}</h3>
                          <p className="author">{v.author_name}</p>
                          {v.theme && (
                            <p
                              className={`theme-tag ${code === "theme" ? "prominent" : ""}`}
                            >
                              テーマ：{v.theme}
                            </p>
                          )}
                          <div className="card-actions">
                            <OtherAwards
                              key={code}
                              awards={otherAwardsByVideo.get(v.video_id) ?? []}
                              title={v.title}
                            />
                            <button
                              aria-pressed={chosen}
                              disabled={disabled || own}
                              className={`select-button ${chosen ? "selected" : ""}`}
                              onClick={() => toggle(v)}
                            >
                              {own
                                ? "自分の作品（投票不可）"
                                : chosen
                                  ? "✓ 選択中"
                                  : "＋ 選ぶ"}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
              </div>
              {!videos.length && (
                <p className="empty-state">
                  条件に合う作品が見つかりませんでした。
                </p>
              )}
            </div>
          </div>
        </section>
        <aside
          id="selected"
          className={`selected-pane${overLimit ? " over-limit" : ""}`}
        >
          <div className="selected-heading">
            <span>選択中の作品</span>
            <strong>
              {selectedCount}
              <small> / {award.max_votes}</small>
            </strong>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${Math.min(100, (selectedCount / award.max_votes) * 100)}%`,
              }}
            />
          </div>
          <p className="selection-guide" role="status">
            {original
              ? "原本に記録された作品と感想です。"
              : selected.length < award.min_votes
                ? `あと${award.min_votes - selected.length}作品で必要数を満たします。`
                : overLimit
                  ? `上限を${selected.length - award.max_votes}作品超えています。確定前に${selected.length - award.max_votes}作品の選択を解除してください。`
                  : selected.length === award.max_votes
                    ? "上限の作品数を選択中です。さらに選び、確定前に絞り込むこともできます。"
                    : "必要数を満たしました。さらに選ぶこともできます。"}
          </p>
          {original && originalEntries.length === 0 ? (
            <p className="selection-empty">この部門の回答はありません。</p>
          ) : (
            !original &&
            !selected.length && (
              <div className="selection-empty">
                <span aria-hidden="true">✦</span>
                <p>
                  心に残った作品を
                  <br />
                  「選ぶ」で追加してください。
                </p>
              </div>
            )
          )}
          {original
            ? originalEntries.map((e) => (
                <div className="selected-item" key={e.id}>
                  <div>
                    <span>
                      {e.source_video_number?.toString().padStart(3, "0") ??
                        "—"}
                    </span>
                    <h3>{e.title}</h3>
                  </div>
                  {!isOriginalSelection(e) && (
                    <p className="muted">感想のみの回答です。</p>
                  )}
                  {!e.video_id && isOriginalSelection(e) && (
                    <p className="muted">原本の作品情報で表示しています。</p>
                  )}
                  <label>
                    <span>この作品への感想</span>
                    <textarea
                      aria-label={`${e.title}への感想`}
                      value={e.comment}
                      readOnly
                      rows={3}
                      placeholder="感想は未入力です。"
                    />
                  </label>
                </div>
              ))
            : selected.map((e) => {
                const v = videoMap.get(e.video_id);
                return (
                  <div className="selected-item" key={e.video_id}>
                    <div>
                      <span>
                        {v?.display_order.toString().padStart(3, "0")}
                      </span>
                      <h3>{v?.title ?? e.video_id}</h3>
                      <button
                        aria-label={`${v?.title ?? e.video_id}の選択を解除`}
                        disabled={disabled}
                        onClick={() => removeSelection(e.video_id)}
                      >
                        ×
                      </button>
                    </div>
                    <label>
                      <span>
                        この作品への感想 <small>任意</small>
                      </span>
                      <textarea
                        aria-label={`${v?.title ?? e.video_id}への感想`}
                        value={e.comment}
                        maxLength={1000}
                        disabled={disabled}
                        rows={3}
                        placeholder="心に残ったところを、ひとこと。"
                        onChange={(event) =>
                          change(
                            entries.map((x) =>
                              x === e
                                ? { ...x, comment: event.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <small className="comment-count">
                        {e.comment.length}/1000
                      </small>
                    </label>
                  </div>
                );
              })}
          {selected.length > 0 && !disabled && (
            <button
              className="text-button clear-button"
              onClick={() => {
                const warning = selected.some((e) => e.comment.length > 0)
                  ? `${award.name}の選択をすべて解除すると、入力済みの感想もすべて削除されます。選択をすべて解除しますか？`
                  : `${award.name}の選択をすべて解除しますか？`;
                if (window.confirm(warning))
                  change(entries.filter((e) => e.award_code !== code));
              }}
            >
              この部門の選択をすべて解除
            </button>
          )}
        </aside>
      </div>
      <a
        href="#selected"
        className={`mobile-selection${overLimit ? " over-limit" : ""}`}
      >
        {award.name}　{selectedCount}/{award.max_votes}作品{" "}
        <span>選択一覧へ ↑</span>
      </a>
      {player && <Player video={player} close={() => setPlayer(null)} />}
    </main>
  );
}
