import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { tally, tallyCsvRows } from "../src/lib/tally";
import { readTallyReference } from "../src/lib/tally-reference";
import { csv } from "../src/lib/validation";

const { values } = parseArgs({
  options: {
    year: { type: "string" },
    votes: { type: "string" },
    videos: { type: "string" },
    reference: { type: "string" },
    bonus: { type: "string" },
    out: { type: "string" },
    denominator: { type: "string", default: "143" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    'npm run tally -- --year 2025 --votes <converted.json> --videos <videos.json> --out <出力フォルダ> [--reference <集計Excel.xlsx>] [--bonus <確認済み加点.json>] [--denominator 143]\n過去フォーム変換JSONをローカルで集計します。ネットワーク接続・DB書込はありません。作品のauthor_nico_user_idと回答のnico_user_idを照合して総合賞だけに各1点加算し、自己投票は除外します。ID不足は未確認です。加点JSONは作品番号をキーとする0/1（例 {"33":1,"13":0}）の手動指定です。',
  );
} else {
  const args = z
    .object({
      year: z.coerce.number().int().min(2000).max(2100),
      votes: z.string().min(1),
      videos: z.string().min(1),
      out: z.string().min(1),
      denominator: z.coerce.number().int().min(1).max(100000),
    })
    .parse(values);
  const readJson = async (path: string) =>
    JSON.parse(await readFile(path, "utf8"));
  const workSchema = z.object({
    display_order: z.number().int().positive(),
    video_id: z.string().nullable(),
    title: z.string(),
    author_name: z.string(),
    author_nico_user_id: z.string().nullable().optional(),
    theme: z.string().nullable().optional(),
  });
  const works = z.array(workSchema).parse(await readJson(args.videos));
  const raw = z
    .object({
      ballots: z.array(
        z.object({
          source_row: z.number().int().min(2),
          year: z.number().int(),
          nico_user_id: z.string().nullable().optional(),
        }),
      ),
      entries: z.array(
        z.object({
          source_row: z.number().int().min(2),
          year: z.number().int(),
          award_code: z.string(),
          video_id: z.string().nullable(),
          source_video_number: z.number().int().positive().nullable(),
          source_video_label: z.string().nullable(),
        }),
      ),
    })
    .parse(await readJson(args.votes));
  const rows = new Set(raw.ballots.map((b) => b.source_row));
  const ballotIdentities = new Map(
    raw.ballots.map((b) => [b.source_row, b.nico_user_id]),
  );
  if (
    rows.size !== raw.ballots.length ||
    raw.ballots.some((b) => b.year !== args.year) ||
    raw.entries.some((e) => !rows.has(e.source_row))
  )
    throw new Error("投票の年度・元行番号・明細の対応を確認してください。");
  const reference = values.reference
    ? await readTallyReference(await readFile(values.reference))
    : null;
  if (reference) {
    for (const work of works) {
      const ref = reference.works.find(
        (w) => w.display_order === work.display_order,
      );
      if (ref && ref.video_id !== work.video_id)
        throw new Error(
          `参照Excelと作品IDが一致しません：No.${work.display_order}`,
        );
      if (ref)
        Object.assign(work, {
          duration_seconds: ref.duration_seconds,
          collaboration: ref.collaboration,
          broadcast: ref.broadcast,
        });
    }
  }
  const bonus = values.bonus
    ? z
        .record(z.string(), z.union([z.literal(0), z.literal(1)]))
        .parse(await readJson(values.bonus))
    : undefined;
  const result = tally({
    year: args.year,
    source: "historical",
    ballotCount: raw.ballots.length,
    works,
    entries: raw.entries.map((entry) => ({
      ...entry,
      voter_nico_user_id: ballotIdentities.get(entry.source_row),
    })),
    participatingNicoIds: raw.ballots.map((b) => b.nico_user_id),
    creatorBonus: bonus,
    scoreDenominator: args.denominator,
  });
  const output = resolve(args.out);
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, "ranking.csv"),
    csv(tallyCsvRows(result, "ranking")),
    "utf8",
  );
  await writeFile(
    resolve(output, "score.csv"),
    csv(tallyCsvRows(result, "score")),
    "utf8",
  );
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  if (reference) {
    const comparison = reference.points.map((ref) => {
      const actual = result.rankings.find(
        (r) =>
          r.award_code === ref.award_code &&
          r.display_order === ref.display_order,
      );
      const difference = ref.points - (actual?.points ?? 0);
      return {
        ...ref,
        actual_points: actual?.points ?? 0,
        difference,
        matches: difference === 0,
        within_unconfirmed_bonus:
          ref.award_code === "overall" &&
          actual?.creator_bonus == null &&
          difference >= 0 &&
          difference <= 1,
      };
    });
    const unexpected = comparison.filter(
      (r) => !r.matches && !r.within_unconfirmed_bonus,
    );
    const missing = result.rankings.filter(
      (r) =>
        !reference.points.some(
          (ref) =>
            ref.award_code === r.award_code &&
            ref.display_order === r.display_order,
        ),
    );
    await writeFile(
      resolve(output, "comparison.json"),
      JSON.stringify(
        {
          checked: comparison.length,
          exact: comparison.filter((r) => r.matches).length,
          unconfirmed_bonus_only: comparison.filter(
            (r) => !r.matches && r.within_unconfirmed_bonus,
          ).length,
          unexpected,
          absent_from_reference: missing.map((r) => ({
            award: r.award_code,
            number: r.display_order,
            points: r.points,
          })),
          rows: comparison,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(
      `Excel照合：${comparison.length}件、一致${comparison.filter((r) => r.matches).length}件、未確認加点のみ${comparison.filter((r) => !r.matches && r.within_unconfirmed_bonus).length}件、その他の差分${unexpected.length}件、Excelにない作品${missing.length}件。`,
    );
    if (unexpected.length || missing.length) process.exitCode = 1;
  }
  console.log(
    `${args.year}年度：${result.ballot_count}回答・${result.selection_count}票。出力：${output}`,
  );
  for (const warning of result.warnings) console.log(warning);
}
