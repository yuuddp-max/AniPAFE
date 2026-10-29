"use client";
import { useEffect, useId, useRef } from "react";
import {
  tallyAwards,
  type AdminTallyResult,
  type TallyWork,
} from "@/lib/tally";
import { TallyDetails } from "./tally-details";

export function TallyWorkDetail({
  result,
  work,
  onClose,
  returnFocus,
}: {
  result: AdminTallyResult;
  work: TallyWork;
  onClose: () => void;
  returnFocus: HTMLButtonElement;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (returnFocus.isConnected) returnFocus.focus();
    };
  }, [returnFocus]);
  const score = result.scores.find(
    (row) => row.display_order === work.display_order,
  );
  return (
    <dialog
      ref={dialog}
      className="tally-work-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <div className="admin-toolbar">
        <h2 id={titleId}>
          No.{String(work.display_order).padStart(3, "0")} {work.title}
        </h2>
        <button
          type="button"
          className="button secondary small"
          onClick={onClose}
          autoFocus
        >
          作品詳細を閉じる
        </button>
      </div>
      <p>
        {work.author_name} ／ {result.year}年度・
        {result.source === "historical" ? "過去フォーム原本" : "サイト確定票"}
      </p>
      <p className="muted">
        順位は部門順位表の相対順位です。総合賞の得票には投稿者参加分を含みます。感想一覧の件数とは異なる場合があります。
        {result.provisional && "この集計は暫定です。"}
      </p>
      <div className="table-scroll">
        <table>
          <caption>6部門の得票・順位</caption>
          <thead>
            <tr>
              <th>部門</th>
              <th>順位</th>
              <th>投票分</th>
              <th>投稿者参加分</th>
              <th>得票</th>
            </tr>
          </thead>
          <tbody>
            {tallyAwards.map((award) => {
              const row = result.rankings.find(
                (r) =>
                  r.display_order === work.display_order &&
                  r.award_code === award.code,
              );
              return (
                <tr key={award.code}>
                  <th scope="row">{award.name}</th>
                  <td>{row ? `${row.relative_rank}位` : "—"}</td>
                  <td>{row?.raw_votes ?? 0}</td>
                  <td>
                    {award.code === "overall"
                      ? (row?.creator_bonus ??
                        (score?.creator_voted === false ? 0 : "未確認"))
                      : "対象外"}
                  </td>
                  <td>{row?.votes ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {score && (
        <p>
          スコア：{score.score.toFixed(3)}（分母{result.score_denominator}）
        </p>
      )}
      <section aria-label="この作品の投票明細・感想">
        <h3>この作品に寄せられた感想・投票明細</h3>
        <TallyDetails result={result} workNumber={work.display_order} />
      </section>
    </dialog>
  );
}
