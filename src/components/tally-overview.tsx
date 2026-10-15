import { BarChart3, Files, Layers3, Trophy, Users } from "lucide-react";
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

export function TallyOverview({
  result,
  award,
  onAwardChange,
}: {
  result: AdminTallyResult;
  award: string;
  onAwardChange: (award: string) => void;
}) {
  const rows = result.rankings.filter((row) => row.award_code === award);
  const department = tallyAwards.find((item) => item.code === award)!;
  const totals = tallyAwards.map((item) => ({
    ...item,
    votes: result.rankings.reduce(
      (sum, row) => sum + (row.award_code === item.code ? row.votes : 0),
      0,
    ),
  }));
  const maxTotal = Math.max(1, ...totals.map((item) => item.votes));
  const maxVotes = Math.max(1, ...rows.map((row) => row.votes));
  return (
    <>
      <div className="tally-section-heading">
        <div>
          <span className="tally-kicker">AWARD HIGHLIGHTS</span>
          <h3>部門別ハイライト</h3>
        </div>
        <span className="tally-subtle">
          部門を選ぶと、上位作品・グラフ・順位表が切り替わります
        </span>
      </div>
      <div
        className="tally-award-tabs"
        role="group"
        aria-label="ハイライトの部門"
      >
        {tallyAwards.map((item) => (
          <button
            type="button"
            key={item.code}
            aria-pressed={award === item.code}
            onClick={() => onAwardChange(item.code)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {rows.length > 0 ? (
        <div
          className="tally-leaders"
          aria-label={`${department.name}の上位3作品`}
        >
          {rows.slice(0, 3).map((row) => (
            <article
              key={row.display_order}
              className={`tally-leader${row.relative_rank === 1 ? " is-leading" : ""}`}
            >
              <div className="tally-leader-top">
                <span className="tally-rank-medal">
                  <Trophy size={15} aria-hidden="true" />
                  {row.relative_rank}
                  <small>位</small>
                </span>
                <span>No.{String(row.display_order).padStart(3, "0")}</span>
              </div>
              <h4>{row.title}</h4>
              <p>{row.author_name}</p>
              <div className="tally-leader-bottom">
                <strong>
                  {format(row.votes)}
                  <small>票</small>
                </strong>
                <span>{result.provisional ? "暫定順位" : "部門順位"}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="tally-empty">
          {department.name}の投票データはありません。
        </p>
      )}
      <div className="tally-charts">
        <section
          className="tally-chart-card"
          aria-label={`${department.name}の得票グラフ`}
        >
          <div className="tally-section-heading">
            <div>
              <h3>{department.name}の得票分布</h3>
              <p>上位8作品 · 票数で比較</p>
            </div>
            <BarChart3 size={21} aria-hidden="true" />
          </div>
          {rows.length ? (
            <ol className="tally-bars">
              {rows.slice(0, 8).map((row) => (
                <li key={row.display_order}>
                  <span className="tally-bar-rank">{row.relative_rank}</span>
                  <div className="tally-bar-content">
                    <div>
                      <span title={row.title}>{row.title}</span>
                      <strong>
                        {format(row.votes)}
                        <small>票</small>
                      </strong>
                    </div>
                    <div className="tally-bar-track" aria-hidden="true">
                      <span
                        style={{ width: `${(row.votes / maxVotes) * 100}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="tally-empty">得票のある作品はありません。</p>
          )}
          <p className="tally-chart-note">
            票数は製作者加点を含みません。順位は同点時の補助合計も使用します。
          </p>
        </section>
        <section
          className="tally-chart-card tally-departments"
          aria-label="部門別の投票数"
        >
          <div className="tally-section-heading">
            <div>
              <h3>部門別の投票数</h3>
              <p>全{format(result.selection_count)}票の内訳</p>
            </div>
            <Layers3 size={21} aria-hidden="true" />
          </div>
          {totals.map((item) => (
            <button
              type="button"
              key={item.code}
              aria-pressed={award === item.code}
              onClick={() => onAwardChange(item.code)}
            >
              <span className="tally-department-label">
                <span>{item.name}</span>
                <strong>
                  {format(item.votes)}
                  <small>票</small>
                </strong>
              </span>
              <span className="tally-bar-track" aria-hidden="true">
                <span style={{ width: `${(item.votes / maxTotal) * 100}%` }} />
              </span>
            </button>
          ))}
        </section>
      </div>
    </>
  );
}
