import test from "node:test";
import assert from "node:assert/strict";
import {
  countCreators,
  countParticipatingCreators,
  tally,
  tallyAwards,
  tallyCsvRows,
  type TallyEntry,
  type TallyWork,
} from "../src/lib/tally";
import { csv } from "../src/lib/validation";

test("製作者の投票者数は作品数・回答数によらずニコニコIDで重複を除き、参加未確認は含めない", () => {
  const result = tally({
    year: 2026,
    source: "historical",
    ballotCount: 5,
    works: ["00010", "10", "11", null, "12"].map((id, index) => ({
      display_order: index + 1,
      video_id: `sm${index + 1}`,
      title: `作品${index + 1}`,
      author_name: "製作者",
      author_nico_user_id: id,
    })),
    entries: [],
    participatingNicoIds: ["10", "10", "11", "99999", null],
  });
  assert.equal(countParticipatingCreators(result.scores), 2);
  assert.equal(countCreators(result.scores), 3);
  assert.equal(countCreators([]), 0);
  assert.equal(
    countCreators([
      { author_nico_user_id: null },
      { author_nico_user_id: "" },
      { author_nico_user_id: "invalid" },
      { author_nico_user_id: " 00010 " },
      { author_nico_user_id: "10" },
    ]),
    1,
  );
  assert.equal(countParticipatingCreators([]), 0);
  assert.equal(
    countParticipatingCreators([
      { creator_voted: false, author_nico_user_id: "10" },
      { creator_voted: null, author_nico_user_id: "11" },
      { creator_voted: true, author_nico_user_id: null },
    ]),
    0,
  );
});
const works: TallyWork[] = [1, 2, 3, 4].map((n) => ({
  display_order: n,
  video_id: `sm${n}`,
  title: `作品${n}`,
  author_name: `製作者${n}`,
  theme: n === 1 ? "テーマ" : null,
}));
function votes(number: number, award_code: string, n: number): TallyEntry[] {
  return Array.from({ length: n }, () => ({
    year: 2025,
    award_code,
    video_id: `sm${number}`,
  }));
}
const calculate = (
  entries: TallyEntry[],
  creatorBonus?: Record<string, 0 | 1>,
) =>
  tally({
    year: 2025,
    source: "historical",
    ballotCount: 10,
    works,
    entries,
    creatorBonus,
  });
test("Excelの補助合計・絶対/相対の密順位・テーマ合計と暫定加点", () => {
  const result = calculate([
    ...votes(1, "overall", 3),
    ...votes(2, "overall", 3),
    ...votes(3, "overall", 3),
    ...votes(4, "overall", 2),
    ...votes(2, "creative", 2),
    ...votes(3, "creative", 2),
    ...votes(1, "theme", 9),
    ...votes(2, "theme", 9),
  ]);
  const rows = result.rankings.filter((r) => r.award_code === "overall");
  assert.deepEqual(
    rows.map((r) => [
      r.display_order,
      r.points,
      r.total_points,
      r.absolute_rank,
      r.relative_rank,
      r.max_points,
    ]),
    [
      [2, 3, 5, 1, 1, 4],
      [3, 3, 5, 1, 1, 4],
      [1, 3, 3, 1, 2, 4],
      [4, 2, 2, 2, 3, 3],
    ],
  );
  const theme = result.rankings.filter((r) => r.award_code === "theme");
  assert.deepEqual(
    theme.map((r) => [r.display_order, r.total_points]),
    [
      [2, 11],
      [1, 9],
    ],
  );
  assert.equal(result.provisional, true);
  assert.equal(result.rankings[0].creator_bonus, null);
});
test("確認済み0と未確認を区別し、加点1は総合だけに一度適用", () => {
  const result = calculate(
    [
      ...votes(1, "overall", 1),
      ...votes(2, "overall", 2),
      ...votes(1, "theme", 1),
    ],
    { "1": 1, "2": 0, "3": 0, "4": 0 },
  );
  const first = result.rankings.find(
    (r) => r.award_code === "overall" && r.display_order === 1,
  )!;
  assert.equal(first.votes, 2);
  assert.equal(first.raw_votes, 1);
  assert.equal(first.creator_voted, true);
  assert.equal(first.points, 2);
  assert.equal(first.max_points, 2);
  assert.equal(
    result.rankings.find((r) => r.award_code === "theme")!.total_points,
    1,
  );
  assert.equal(result.provisional, false);
  const zeroVotes = calculate([], { "4": 1 });
  assert.equal(zeroVotes.rankings[0].points, 1);
});

test("投稿者のニコニコIDを正規化して全投稿作品の総合賞だけに1点加算する", () => {
  const result = tally({
    year: 2025,
    source: "site",
    ballotCount: 3,
    works: works.map((w) => ({
      ...w,
      author_nico_user_id: w.display_order <= 2 ? "000123" : "456",
    })),
    entries: [...votes(1, "overall", 2), ...votes(1, "music", 1)],
    participatingNicoIds: ["123", "000123", "789"],
  });
  const rows = result.rankings.filter((r) => r.award_code === "overall");
  assert.deepEqual(
    rows.map((r) => [
      r.display_order,
      r.votes,
      r.creator_bonus,
      r.points,
      r.total_points,
    ]),
    [
      [1, 3, 1, 3, 4],
      [2, 1, 1, 1, 1],
    ],
  );
  assert.equal(
    result.rankings.find((r) => r.award_code === "music")!.points,
    1,
  );
  assert.equal(result.selection_count, 3);
  assert.equal(result.provisional, false);
  assert.equal(
    result.scores.find((r) => r.display_order === 1)!.creator_voted,
    true,
  );
  assert.equal(
    result.scores.find((r) => r.display_order === 3)!.creator_voted,
    false,
  );
  assert.equal(
    result.scores.find((r) => r.display_order === 2)!.ranks.overall,
    2,
  );
});

test("総合50票は参加分を含む51票とし、他部門・未参加・未確認を区別する", () => {
  const result = tally({
    year: 2025,
    source: "historical",
    ballotCount: 51,
    works: works.slice(0, 3).map((work, index) => ({
      ...work,
      author_nico_user_id: index === 0 ? "123" : index === 1 ? "999" : null,
    })),
    entries: [
      ...votes(1, "overall", 50),
      ...votes(1, "music", 2),
      ...votes(2, "overall", 4),
      ...votes(3, "overall", 1),
    ],
    participatingNicoIds: ["000123", "456"],
  });
  const overall = result.rankings.filter((r) => r.award_code === "overall");
  assert.deepEqual(
    overall.map((r) => [r.votes, r.raw_votes, r.creator_voted]),
    [
      [51, 50, true],
      [4, 4, false],
      [1, 1, null],
    ],
  );
  const music = result.rankings.find((r) => r.award_code === "music")!;
  assert.equal(music.votes, 2);
  assert.equal(music.creator_voted, true);
  const exported = tallyCsvRows(result, "ranking");
  const headers = exported[0];
  assert.ok(headers.every((header) => !String(header).includes("得点")));
  assert.equal(exported[1][headers.indexOf("票数")], 51);
  assert.equal(exported[1][headers.indexOf("元の票数")], 50);
  assert.equal(exported[1][headers.indexOf("投稿者の投票参加")], "参加済み");
});

test("ID未記入では加点を推測せず、照合済み1点と未確認を区別する", () => {
  const result = tally({
    year: 2025,
    source: "historical",
    ballotCount: 3,
    works: works.map((w) => ({
      ...w,
      author_nico_user_id: w.display_order === 1 ? "123" : "456",
    })),
    entries: [...votes(1, "overall", 1), ...votes(2, "overall", 1)],
    participatingNicoIds: ["000123", null, "invalid"],
  });
  const rows = result.rankings;
  assert.equal(rows.find((r) => r.display_order === 1)!.creator_bonus, 1);
  assert.equal(rows.find((r) => r.display_order === 2)!.creator_bonus, null);
  assert.equal(rows.find((r) => r.display_order === 2)!.creator_voted, null);
  assert.equal(result.provisional, true);
  const empty = tally({
    year: 2025,
    source: "site",
    ballotCount: 0,
    works: [{ ...works[0], author_nico_user_id: "123" }],
    entries: [],
    participatingNicoIds: [],
  });
  assert.deepEqual(empty.rankings, []);
  assert.equal(empty.provisional, false);
});

test("過去原本の自己投票を全6賞で除外し、名前が同じ別IDの票は残す", () => {
  const result = tally({
    year: 2025,
    source: "historical",
    ballotCount: 2,
    works: [{ ...works[0], author_nico_user_id: "123" }],
    entries: tallyAwards.flatMap((a) => [
      { ...votes(1, a.code, 1)[0], voter_nico_user_id: "000123" },
      { ...votes(1, a.code, 1)[0], voter_nico_user_id: "456" },
    ]),
    participatingNicoIds: ["123", "456"],
  });
  assert.equal(result.selection_count, 6);
  assert.ok(result.warnings.some((w) => w.includes("自己投票6票")));
  assert.ok(result.rankings.every((r) => r.raw_votes === 1));
  assert.ok(result.rankings.every((r) => r.creator_voted === true));
  assert.equal(
    result.rankings.find((r) => r.award_code === "overall")!.points,
    2,
  );
  assert.ok(
    result.rankings
      .filter((r) => r.award_code !== "overall")
      .every((r) => r.points === 1),
  );
});
test("Excelなしで投票明細の変更から得点・同点順位・スコアを再計算する", () => {
  const entries = [
    ...votes(1, "overall", 2),
    ...votes(2, "overall", 1),
    ...votes(2, "creative", 1),
  ];
  const before = calculate(entries);
  const tied = calculate([...entries, ...votes(2, "overall", 1)]);
  const after = calculate([...entries, ...votes(2, "overall", 2)]);
  const overall = (result: ReturnType<typeof calculate>) =>
    result.rankings
      .filter((r) => r.award_code === "overall")
      .map((r) => [
        r.display_order,
        r.points,
        r.total_points,
        r.absolute_rank,
        r.relative_rank,
      ]);
  assert.deepEqual(overall(before), [
    [1, 2, 2, 1, 1],
    [2, 1, 2, 2, 2],
  ]);
  assert.deepEqual(overall(tied), [
    [2, 2, 3, 1, 1],
    [1, 2, 2, 1, 2],
  ]);
  assert.deepEqual(overall(after), [
    [2, 3, 4, 1, 1],
    [1, 2, 2, 2, 2],
  ]);
  const workTwo = (result: ReturnType<typeof calculate>) =>
    result.scores.find((r) => r.display_order === 2)!;
  assert.ok(Math.abs(workTwo(before).score - (2 - 3 / 143) * 100) < 1e-9);
  assert.ok(Math.abs(workTwo(after).score - 2 * (1 - 1 / 143) * 100) < 1e-9);
  assert.deepEqual(
    [before.selection_count, tied.selection_count, after.selection_count],
    [4, 5, 6],
  );
  assert.equal(entries.length, 4);
  assert.deepEqual(calculate(entries), before);
});
test("作品未対応・重複選択を省略せず、感想のみは票に数えない", () => {
  const result = calculate([
    {
      year: 2025,
      award_code: "overall",
      video_id: null,
      source_video_number: 72,
      source_video_label: "072 削除済み作品",
    },
    {
      year: 2025,
      award_code: "overall",
      video_id: null,
      source_video_number: 72,
      source_video_label: "072 削除済み作品",
    },
    {
      year: 2025,
      award_code: "creative",
      video_id: null,
      source_video_number: null,
    },
  ]);
  assert.equal(result.selection_count, 2);
  assert.equal(result.comment_only_count, 1);
  assert.equal(result.work_count, works.length);
  assert.equal(result.rankings[0].votes, 2);
  assert.equal(result.rankings[0].unmapped, true);
  assert.equal(result.rankings[0].display_order, 72);
});
test("スコアの閾値・分母143・受賞数は総合を除外", () => {
  const many = Array.from({ length: 72 }, (_, i) => ({
    ...works[0],
    display_order: i + 1,
    video_id: `sm${i + 1}`,
  }));
  const entries = many.flatMap((w, i) =>
    tallyAwards.flatMap((a) => votes(w.display_order, a.code, 72 - i)),
  );
  const result = tally({
    year: 2025,
    source: "historical",
    ballotCount: 100,
    works: many,
    entries,
  });
  assert.equal(result.scores[0].award_count, 5);
  assert.ok(Math.abs(result.scores[0].score - 6 * (1 - 1 / 143) * 100) < 1e-9);
  assert.equal(result.scores[9].ranks.theme, 10);
  assert.equal(result.scores[10].ranks.theme, null);
  assert.equal(result.scores[14].ranks.creative, 15);
  assert.equal(result.scores[15].ranks.creative, null);
  assert.equal(result.scores[69].ranks.overall, 70);
  assert.equal(result.scores[70].ranks.overall, null);
  assert.equal(result.scores[71].score, 0);
});
test("放送対象は手動指定、再掲は60秒、相対1位は全編、時間不明はnull", () => {
  const w: TallyWork[] = [
    {
      ...works[0],
      duration_seconds: 200,
      broadcast: {
        overall: true,
        music: true,
        composition: false,
        humor: false,
        creative: false,
        theme: true,
      },
    },
    {
      ...works[1],
      duration_seconds: 180,
      broadcast: { overall: false, music: true },
    },
  ];
  const result = tally({
    year: 2025,
    source: "historical",
    ballotCount: 3,
    works: w,
    entries: [
      ...votes(1, "overall", 1),
      ...votes(1, "music", 1),
      ...votes(2, "music", 2),
      ...votes(1, "theme", 1),
    ],
  });
  assert.equal(
    result.rankings.find(
      (r) => r.display_order === 1 && r.award_code === "music",
    )!.broadcast_seconds,
    60,
  );
  assert.equal(
    result.rankings.find(
      (r) => r.display_order === 2 && r.award_code === "music",
    )!.broadcast_seconds,
    180,
  );
  assert.equal(
    result.rankings.find((r) => r.award_code === "theme")!.broadcast_seconds,
    200,
  );
  const unset = calculate(votes(1, "overall", 1)).rankings[0];
  assert.equal(unset.broadcast_selected, null);
  assert.equal(unset.broadcast_seconds, null);
});
test("混在年度・不明部門・不正な作品対応・不正加点を拒否", () => {
  assert.throws(
    () => calculate([{ ...votes(1, "overall", 1)[0], year: 2024 }]),
    /別年度/,
  );
  assert.throws(() => calculate(votes(1, "fake", 1)), /未知/);
  assert.throws(() => calculate(votes(99, "overall", 1)), /特定/);
  assert.throws(
    () => calculate([{ ...votes(1, "overall", 1)[0], source_video_number: 2 }]),
    /一致/,
  );
  assert.throws(() => calculate([], { "99": 1 }), /加点/);
  assert.throws(
    () =>
      tally({
        year: 2025,
        source: "site",
        ballotCount: 0,
        works,
        entries: [],
        scoreDenominator: 0,
      }),
    /分母/,
  );
});
test("空データとCSVの式注入対策、個人の投票情報は出力しない", () => {
  assert.deepEqual(calculate([]).rankings, []);
  const result = tally({
    year: 2025,
    source: "historical",
    ballotCount: 1,
    works: [{ ...works[0], title: "=HYPERLINK(1)", author_name: "@cmd" }],
    entries: votes(1, "overall", 1),
  });
  const exported = csv(tallyCsvRows(result, "ranking"));
  assert.ok(exported.includes("'=HYPERLINK(1)"));
  assert.ok(exported.includes("'@cmd"));
  assert.ok(!exported.includes("投票者"));
  assert.ok(exported.includes("未確認"));
});
