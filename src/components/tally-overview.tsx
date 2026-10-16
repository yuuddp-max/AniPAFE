import { Clapperboard, Users } from "lucide-react";
import {
  countCreators,
  countParticipatingCreators,
  type AdminTallyResult,
} from "@/lib/tally";

const format = (value: number) => value.toLocaleString("ja-JP");

export function TallyMetrics({ result }: { result: AdminTallyResult }) {
  const participatingCreators = countParticipatingCreators(result.scores);
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
          label: "製作者数",
          value: countCreators(result.scores),
          unit: "名",
          hint: "集計年度の製作者（ニコニコIDの重複を除く）",
          icon: Users,
        },
        {
          label: "投票者数",
          value: result.ballot_count,
          unit: "名",
          hint:
            result.source === "historical"
              ? "過去フォームの回答"
              : "確定済みの投票のみ",
          icon: Users,
        },
        {
          label: "投票者数（製作者）",
          value: participatingCreators,
          unit: "名",
          hint: "投票参加を確認できた製作者（重複除く）",
          icon: Users,
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
