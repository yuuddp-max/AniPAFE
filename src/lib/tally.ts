import type { AwardCode } from "./types";
import { jst, normalizeNicoId } from "./validation";

export const tallyAwards: {
  code: AwardCode;
  name: string;
  scoreLimit: number;
}[] = [
  { code: "overall", name: "総合賞", scoreLimit: 70 },
  { code: "music", name: "選曲賞", scoreLimit: 15 },
  { code: "composition", name: "構成賞", scoreLimit: 15 },
  { code: "humor", name: "諧謔賞", scoreLimit: 15 },
  { code: "creative", name: "クリエイティブ賞", scoreLimit: 15 },
  { code: "theme", name: "テーマ賞", scoreLimit: 10 },
];
export type TallyWork = {
  display_order: number;
  video_id: string | null;
  title: string;
  author_name: string;
  author_nico_user_id?: string | null;
  theme?: string | null;
  duration_seconds?: number | null;
  collaboration?: string | null;
  broadcast?: Partial<Record<AwardCode, boolean>>;
};
export type TallyEntry = {
  year: number;
  award_code: string;
  video_id: string | null;
  source_video_number?: number | null;
  source_video_label?: string | null;
  voter_nico_user_id?: string | null;
};
export type TallyRow = TallyWork & {
  unmapped: boolean;
  award_code: AwardCode;
  award_name: string;
  votes: number;
  raw_votes: number;
  creator_voted: boolean | null;
  creator_bonus: 0 | 1 | null;
  points: number;
  max_points: number;
  total_points: number;
  absolute_rank: number;
  relative_rank: number;
  broadcast_selected: boolean | null;
  shortened: boolean | null;
  broadcast_seconds: number | null;
};
export type TallyScore = TallyWork & {
  creator_voted: boolean | null;
  ranks: Record<AwardCode, number | null>;
  scores: Record<AwardCode, number>;
  award_count: number;
  score: number;
};

export function countCreators(
  works: readonly Pick<TallyWork, "author_nico_user_id">[],
): number {
  return new Set(
    works.flatMap((work) => {
      const id = work.author_nico_user_id?.trim();
      return id && /^[0-9]{1,30}$/.test(id) ? [normalizeNicoId(id)] : [];
    }),
  ).size;
}

export function countParticipatingCreators(
  works: readonly Pick<TallyScore, "creator_voted" | "author_nico_user_id">[],
): number {
  return countCreators(works.filter((work) => work.creator_voted === true));
}

export type TallyResult = {
  year: number;
  source: string;
  work_count: number;
  ballot_count: number;
  selection_count: number;
  comment_only_count: number;
  score_denominator: number;
  provisional: boolean;
  warnings: string[];
  rankings: TallyRow[];
  scores: TallyScore[];
};
export type TallyDetail = {
  id: string;
  work_number?: number | null;
  award_name: string;
  video_id: string | null;
  title: string;
  display_name: string;
  nico_user_id: string;
  comment: string;
  timestamp: string | null;
  source_timestamp: string | null;
};
export type AdminTallyResult = TallyResult & {
  detail_count?: number;
  calculated_at?: string;
  historical_ballot_count: number;
  historical_selection_count: number;
  details?: TallyDetail[];
};
const mainAwards: AwardCode[] = [
  "overall",
  "music",
  "composition",
  "humor",
  "creative",
];
const broadcastOrder: AwardCode[] = [...mainAwards, "theme"];

const nicoIdentity = (value?: string | null) =>
  value != null && /^[0-9]{1,30}$/.test(value.trim())
    ? normalizeNicoId(value)
    : null;

/** Pure calculation: matches numeric Nico IDs only, never names. */
export function tally(input: {
  year: number;
  source: string;
  ballotCount: number;
  works: TallyWork[];
  entries: TallyEntry[];
  creatorBonus?: Record<string, 0 | 1>;
  participatingNicoIds?: (string | null | undefined)[];
  scoreDenominator?: number;
}): TallyResult {
  const denominator = input.scoreDenominator ?? 143;
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100)
    throw new Error("年度が不正です。");
  if (!Number.isInteger(denominator) || denominator < 1 || denominator > 100000)
    throw new Error("スコアの分母は1～100000の整数にしてください。");
  const works = new Map<number, TallyWork & { unmapped: boolean }>();
  const ids = new Map<string, number>();
  for (const work of input.works) {
    if (
      !Number.isInteger(work.display_order) ||
      work.display_order < 1 ||
      works.has(work.display_order)
    )
      throw new Error("作品番号が不正または重複しています。");
    if (work.video_id && ids.has(work.video_id))
      throw new Error("作品IDが重複しています。");
    if (
      work.duration_seconds != null &&
      (!Number.isFinite(work.duration_seconds) || work.duration_seconds < 0)
    )
      throw new Error("作品の時間が不正です。");
    works.set(work.display_order, { ...work, unmapped: false });
    if (work.video_id) ids.set(work.video_id, work.display_order);
  }
  const counts = new Map<number, Record<AwardCode, number>>();
  const emptyCounts = () =>
    Object.fromEntries(tallyAwards.map((a) => [a.code, 0])) as Record<
      AwardCode,
      number
    >;
  let selections = 0,
    commentOnly = 0,
    selfVotes = 0;
  for (const entry of input.entries) {
    if (entry.year !== input.year)
      throw new Error("別年度の投票明細が含まれています。");
    if (!tallyAwards.some((a) => a.code === entry.award_code))
      throw new Error("未知の部門が含まれています。");
    if (!entry.video_id && entry.source_video_number == null) {
      commentOnly++;
      continue;
    }
    const number = entry.video_id
      ? ids.get(entry.video_id)
      : entry.source_video_number;
    if (number == null || !Number.isInteger(number) || number < 1)
      throw new Error("作品を特定できない投票があります。");
    if (
      entry.video_id &&
      entry.source_video_number != null &&
      entry.source_video_number !== number
    )
      throw new Error("作品IDと元作品番号が一致しません。");
    if (!works.has(number)) {
      works.set(number, {
        display_order: number,
        video_id: null,
        title: entry.source_video_label || `作品番号 ${number}（作品未対応）`,
        author_name: "未対応",
        unmapped: true,
      });
    }
    const author = nicoIdentity(works.get(number)?.author_nico_user_id);
    if (author !== null && author === nicoIdentity(entry.voter_nico_user_id)) {
      selfVotes++;
      continue;
    }
    const count = counts.get(number) ?? emptyCounts();
    count[entry.award_code as AwardCode]++;
    counts.set(number, count);
    selections++;
  }
  const bonus: Record<string, 0 | 1> = Object.create(null);
  if (input.participatingNicoIds !== undefined) {
    const identities = input.participatingNicoIds.map(nicoIdentity);
    const participants = new Set(identities.filter((id) => id !== null));
    const complete = identities.every((id) => id !== null);
    for (const [number, work] of works) {
      const author = nicoIdentity(work.author_nico_user_id);
      if (author !== null && participants.has(author)) bonus[number] = 1;
      else if (author !== null && complete) bonus[number] = 0;
    }
  }
  Object.assign(bonus, input.creatorBonus);
  for (const [number, value] of Object.entries(bonus)) {
    if (
      !/^[1-9]\d*$/.test(number) ||
      !works.has(Number(number)) ||
      (value !== 0 && value !== 1)
    )
      throw new Error(
        "製作者加点は存在する作品番号に0または1を指定してください。",
      );
  }
  const rankings: TallyRow[] = [];
  for (const award of tallyAwards) {
    const rows: TallyRow[] = [];
    for (const [number, work] of works) {
      const count = counts.get(number) ?? emptyCounts();
      const creator = Object.hasOwn(bonus, String(number))
        ? bonus[number]
        : null;
      const overall = count.overall + (creator ?? 0);
      const points = award.code === "overall" ? overall : count[award.code];
      if (!points) continue;
      // Theme's Excel SUM(I:L)+C deliberately omits the overall points.
      const total = mainAwards.reduce(
        (sum, code) => sum + (code === "overall" ? overall : count[code]),
        0,
      );
      rows.push({
        ...work,
        award_code: award.code,
        award_name: award.name,
        votes: points,
        raw_votes: count[award.code],
        creator_voted: creator === null ? null : creator === 1,
        creator_bonus: award.code === "overall" ? creator : 0,
        points,
        max_points:
          points + (award.code === "overall" && creator === null ? 1 : 0),
        total_points: award.code === "theme" ? total - overall + points : total,
        absolute_rank: 0,
        relative_rank: 0,
        broadcast_selected: work.broadcast?.[award.code] ?? null,
        shortened: null,
        broadcast_seconds: null,
      });
    }
    rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.total_points - a.total_points ||
        a.display_order - b.display_order,
    );
    let absolute = 0,
      relative = 0;
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      if (!prev || prev.points !== row.points) absolute++;
      if (
        !prev ||
        prev.points !== row.points ||
        prev.total_points !== row.total_points
      )
        relative++;
      row.absolute_rank = absolute;
      row.relative_rank = relative;
    });
    rankings.push(...rows);
  }
  // Broadcast flags are editorial inputs in the sample, never inferred from rank.
  for (const row of rankings) {
    if (row.broadcast_selected === null) continue;
    if (!row.broadcast_selected) {
      row.shortened = false;
      row.broadcast_seconds = 0;
      continue;
    }
    const previous = broadcastOrder.slice(
      0,
      broadcastOrder.indexOf(row.award_code),
    );
    const flags = previous.map((code) => row.broadcast?.[code]);
    const repeated = flags.some((flag) => flag === true);
    if (row.award_code === "overall" || row.relative_rank === 1)
      row.shortened = false;
    else if (repeated) row.shortened = true;
    else if (flags.every((flag) => flag !== undefined)) row.shortened = false;
    if (row.shortened === true) row.broadcast_seconds = 60;
    else if (row.shortened === false)
      row.broadcast_seconds = row.duration_seconds ?? null;
  }
  const byWork = new Map<number, Map<AwardCode, TallyRow>>();
  for (const row of rankings) {
    const map = byWork.get(row.display_order) ?? new Map();
    map.set(row.award_code, row);
    byWork.set(row.display_order, map);
  }
  const scores = [...works.values()]
    .sort((a, b) => a.display_order - b.display_order)
    .map((work) => {
      const ranks = {} as TallyScore["ranks"],
        scores = {} as TallyScore["scores"];
      for (const award of tallyAwards) {
        const rank = byWork
          .get(work.display_order)
          ?.get(award.code)?.relative_rank;
        ranks[award.code] =
          rank != null && rank <= award.scoreLimit ? rank : null;
        scores[award.code] =
          ranks[award.code] == null
            ? 0
            : (1 - ranks[award.code]! / denominator) * 100;
      }
      return {
        ...work,
        creator_voted: Object.hasOwn(bonus, String(work.display_order))
          ? bonus[work.display_order] === 1
          : null,
        ranks,
        scores,
        award_count: tallyAwards.filter(
          (a) => a.code !== "overall" && ranks[a.code] != null,
        ).length,
        score: Object.values(scores).reduce((sum, value) => sum + value, 0),
      };
    });
  const provisional = [...works.keys()].some(
    (number) => !Object.hasOwn(bonus, String(number)),
  );
  const warnings = [
    "同じ年度・集計元で投票した投稿者の作品は、ニコニコIDで照合して総合賞の票数だけに各1票加算します。自己投票は票数に含めません。",
    ...(selfVotes
      ? [
          `ニコニコIDが一致する自己投票${selfVotes}票を集計から除外しました。原本は変更していません。`,
        ]
      : []),
    ...(provisional
      ? [
          "投稿者の投票参加が未確認の作品には参加分の1票を加えていません。参加状況が確認できると総合賞の票数・同点時の補助合計・順位・スコアが変わる可能性があります。",
        ]
      : []),
    "順位は票数→補助合計の降順で計算し、同じ値は同順位（1、1、2）です。0票作品は部門順位の対象外です。",
    "補助合計は総合・選曲・構成・諧謔・クリエイティブの5部門。テーマ賞のみ総合を除きテーマを加えます。",
    `スコアはサンプルの式 (1−相対順位/${denominator})×100。対象は総合70位・テーマ10位・他15位以内、受賞数は総合を除く5部門です。`,
    "放送対象はExcel上の手動指定です。未指定の放送対象・動画時間は推測しません。",
    ...([...works.values()].some((w) => w.unmapped)
      ? [
          "作品マスターにない作品への票も元作品番号で集計しています（作品未対応）。",
        ]
      : []),
  ];
  return {
    year: input.year,
    source: input.source,
    work_count: input.works.length,
    ballot_count: input.ballotCount,
    selection_count: selections,
    comment_only_count: commentOnly,
    score_denominator: denominator,
    provisional,
    warnings,
    rankings,
    scores,
  };
}

export function tallyCsvRows(
  result: TallyResult & { details?: TallyDetail[] },
  type: "ranking" | "score" | "details",
): unknown[][] {
  if (type === "details") {
    if (!result.details) throw new Error("投票明細が読み込まれていません。");
    return [
      [
        "部門",
        "作品ID",
        "作品名",
        "投票者表示名",
        "ニコニコユーザーID",
        "コメント",
        "投票時刻（JST）",
        "元の日時表記",
        "年度",
        "集計元",
      ],
      ...result.details.map((d) => [
        d.award_name,
        d.video_id,
        d.title,
        d.display_name,
        d.nico_user_id,
        d.comment,
        jst(d.timestamp),
        d.source_timestamp,
        result.year,
        result.source,
      ]),
    ];
  }
  if (type === "score")
    return [
      [
        "年度",
        "集計元",
        "作品番号",
        "作品名",
        "製作者",
        "投稿者の投票参加",
        ...tallyAwards.map((a) => `${a.name}順位`),
        "受賞数（総合除く）",
        ...tallyAwards.map((a) => `${a.name}スコア`),
        "スコア",
        "暫定",
        "スコア分母",
      ],
      ...result.scores.map((r) => [
        result.year,
        result.source,
        r.display_order,
        r.title,
        r.author_name,
        r.creator_voted === null
          ? "未確認"
          : r.creator_voted
            ? "参加済み"
            : "参加なし",
        ...tallyAwards.map((a) => r.ranks[a.code]),
        r.award_count,
        ...tallyAwards.map((a) => r.scores[a.code]),
        r.score,
        result.provisional ? "はい" : "いいえ",
        result.score_denominator,
      ]),
    ];
  return [
    [
      "年度",
      "集計元",
      "部門",
      "順位（絶対）",
      "順位（相対）",
      "作品番号",
      "作品ID",
      "作品名",
      "製作者",
      "テーマ",
      "合作",
      "票数",
      "元の票数",
      "投稿者の投票参加",
      "参加分の票",
      "補助合計",
      "作品対応",
      "放送対象",
      "短縮対象",
      "動画時間（秒）",
      "放送時間（秒）",
      "暫定",
    ],
    ...result.rankings.map((r) => [
      result.year,
      result.source,
      r.award_name,
      r.absolute_rank,
      r.relative_rank,
      r.display_order,
      r.video_id,
      r.title,
      r.author_name,
      r.theme,
      r.collaboration,
      r.votes,
      r.raw_votes,
      r.creator_voted === null
        ? "未確認"
        : r.creator_voted
          ? "参加済み"
          : "参加なし",
      r.creator_bonus ?? "未確認",
      r.total_points,
      r.unmapped ? "未対応" : "対応済み",
      r.broadcast_selected === null
        ? "未設定"
        : r.broadcast_selected
          ? "○"
          : "",
      r.shortened === null ? "未設定" : r.shortened ? "○" : "",
      r.duration_seconds,
      r.broadcast_seconds,
      result.provisional ? "はい" : "いいえ",
    ]),
  ];
}
