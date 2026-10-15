import { BarChart3, Files, Layers3, Users } from "lucide-react";
import { tallyAwards, type AdminTallyResult } from "@/lib/tally";

const format = (value: number) => value.toLocaleString("ja-JP");

export function TallyMetrics({ result }: { result: AdminTallyResult }) {
  const votedWorks = new Set(
    result.rankings
      .filter((row) => row.votes > 0)
      .map((row) => row.display_order),
  ).size;
  return (
    <div className="tally-metrics" aria-label="投票集計サマリー">
      {[
        {
          label: "総投票数",
          value: result.selection_count,
          unit: "票",
          hint: "全6部門の選択数",
          icon: BarChart3,
        },
        {
          label: "投票回答数",
          value: result.ballot_count,
          unit: "回答",
          hint:
            result.source === "historical"
              ? "過去フォームの回答"
              : "確定済みの投票のみ",
          icon: Users,
        },
        {
          label: "得票作品数",
          value: votedWorks,
          unit: "作品",
          hint: "1票以上の得票がある作品",
          icon: Files,
        },
        {
          label: "集計部門",
          value: tallyAwards.length,
          unit: "部門",
          hint: `選択なしの感想 ${format(result.comment_only_count)}件`,
          icon: Layers3,
        },
      ].map(({ label, value, unit, hint, icon: Icon }, i) => (
        <article
          className={`tally-metric${i === 0 ? " is-primary" : ""}`}
          key={label}
        >
          <div className="tally-metric-label">
            <span>{label}</span>
            <Icon size={18} aria-hidden="true" />
          </div>
          <p>
            <strong>{format(value)}</strong>
            <span>{unit}</span>
          </p>
          <small>{hint}</small>
        </article>
      ))}
    </div>
  );
}
