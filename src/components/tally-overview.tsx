import { Clapperboard, Files, Users } from "lucide-react";
import type { AdminTallyResult } from "@/lib/tally";

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
          label: "作品数合計",
          value: result.work_count,
          unit: "作品",
          hint: "集計年度の登録作品（得票なしを含む）",
          icon: Clapperboard,
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
