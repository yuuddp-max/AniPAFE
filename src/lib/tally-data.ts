import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminRows } from "./admin-data";
import {
  tally,
  tallyAwards,
  type AdminTallyResult,
  type TallyEntry,
  type TallyWork,
} from "./tally";
import type { Profile } from "./types";
import { HttpError } from "./auth";

// Bump when tally rules or the stored payload change.
const calculationVersion = 3;

// Project JSON fields in PostgREST so full comments never cross the DB connection
// for a summary request. The full snapshot remains available to legacy CSV readers.
const summaryFields = [
  "year",
  "source",
  "work_count",
  "ballot_count",
  "selection_count",
  "comment_only_count",
  "score_denominator",
  "provisional",
  "warnings",
  "rankings",
  "scores",
  "historical_ballot_count",
  "historical_selection_count",
  "detail_count",
];
const summarySelect = [
  "calculated_at",
  ...summaryFields.map((key) => `${key}:result->${key}`),
].join(",");

export type TallyBallot = {
  id: string;
  year: number;
  source: string;
  status: string;
  voter_id: string | null;
  display_name: string | null;
  nico_user_id: string | null;
  created_at: string;
  submitted_at: string | null;
  source_timestamp: string | null;
};
export type StoredTallyEntry = TallyEntry & {
  ballot_id: string;
  source: string;
  id: string;
  comment: string | null;
};

// Kept separate from public rankings: imported forms remain unadopted originals.
export async function loadTally(
  db: SupabaseClient,
  year: number,
  source: "site" | "historical" | "auto",
  scoreDenominator: number,
  includeDetails = false,
  force = false,
): Promise<AdminTallyResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: state, error: stateError } = await db.rpc(
      "admin_tally_state",
      {
        p_year: year,
        p_source: source,
      },
    );
    if (stateError) throw stateError;
    const { data: saved, error: readError } = await db
      .from("data_tally_results")
      .select(includeDetails ? "result,calculated_at" : summarySelect)
      .eq("year", year)
      .eq("source", state.source)
      .eq("score_denominator", scoreDenominator)
      .eq("calculation_version", calculationVersion)
      .eq("input_revision", state.revision)
      .maybeSingle();
    if (readError) throw readError;
    if (!force && saved) {
      const row = saved as unknown as AdminTallyResult & {
        result: AdminTallyResult;
      };
      const result = includeDetails
        ? { ...row.result, calculated_at: row.calculated_at }
        : row;
      if (!includeDetails) delete result.details;
      return result;
    }
    // Store one complete snapshot, so details and CSV never trigger a second tally.
    const result = await calculateTally(
      db,
      year,
      state.source,
      scoreDenominator,
    );
    const { data: calculatedAt, error: saveError } = await db.rpc(
      "admin_save_tally_result",
      {
        p_year: year,
        p_source: state.source,
        p_denominator: scoreDenominator,
        p_version: calculationVersion,
        p_revision: state.revision,
        p_result: result,
      },
    );
    if (saveError) throw saveError;
    if (calculatedAt) {
      result.calculated_at = calculatedAt;
      if (!includeDetails) delete result.details;
      return result;
    }
  }
  throw new HttpError(
    409,
    "集計中に投票データが更新されました。再度読み込んでください。",
  );
}

export async function loadTallyDetailPage(
  db: SupabaseClient,
  year: number,
  source: "site" | "historical",
  denominator: number,
  page: number,
  calculatedAt: string,
) {
  const { data: state, error: stateError } = await db.rpc("admin_tally_state", {
    p_year: year,
    p_source: source,
  });
  if (stateError) throw stateError;
  const select = [
    "calculated_at",
    "total:result->detail_count",
    ...Array.from(
      { length: 50 },
      (_, i) => `item_${i}:result->details->${page * 50 + i}`,
    ),
  ].join(",");
  const { data, error } = await db
    .from("data_tally_results")
    .select(select)
    .eq("year", year)
    .eq("source", source)
    .eq("score_denominator", denominator)
    .eq("calculation_version", calculationVersion)
    .eq("input_revision", state.revision)
    .eq("calculated_at", calculatedAt)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new HttpError(
      409,
      "集計結果が更新されました。再集計してから明細を開いてください。",
    );
  const row = data as unknown as {
    total: number;
    calculated_at: string;
  } & Record<string, import("./tally").TallyDetail | null>;
  return {
    page,
    total: row.total,
    calculated_at: row.calculated_at,
    details: Array.from({ length: 50 }, (_, i) => row[`item_${i}`]).filter(
      (item) => item != null,
    ),
  };
}

async function calculateTally(
  db: SupabaseClient,
  year: number,
  source: "site" | "historical",
  scoreDenominator: number,
): Promise<AdminTallyResult> {
  const [works, ballots, entries] = await Promise.all([
    adminRows<TallyWork>(db, "data_mad", year),
    adminRows<TallyBallot>(db, "data_ballot", year),
    adminRows<StoredTallyEntry>(db, "data_ballots", year),
  ]);
  const historical = ballots.filter(
    (b) =>
      b.year === year && b.source === "historical" && b.status === "imported",
  );
  const actualSource = source;
  const selectedBallots = new Map(
    ballots
      .filter(
        (b) =>
          b.year === year &&
          b.source === actualSource &&
          b.status === (actualSource === "site" ? "submitted" : "imported"),
      )
      .map((b) => [b.id, b]),
  );
  const profiles =
    actualSource === "site"
      ? await adminRows<Profile>(db, "data_login_user")
      : [];
  const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
  const identity = (b: TallyBallot) =>
    actualSource === "site"
      ? b.voter_id
        ? profileMap.get(b.voter_id)?.nico_user_id
        : null
      : b.nico_user_id;
  const selectedEntries = entries
    .filter(
      (e) =>
        e.year === year &&
        selectedBallots.has(e.ballot_id) &&
        e.source === actualSource,
    )
    .map((e) => ({
      ...e,
      voter_nico_user_id: identity(selectedBallots.get(e.ballot_id)!),
    }));
  const result: AdminTallyResult = {
    ...tally({
      year,
      source: actualSource,
      ballotCount: selectedBallots.size,
      works,
      entries: selectedEntries,
      participatingNicoIds: [...selectedBallots.values()].map(identity),
      scoreDenominator,
    }),
    historical_ballot_count: historical.length,
    historical_selection_count: 0,
  };
  const historicalIds = new Set(historical.map((b) => b.id));
  result.historical_selection_count = entries.filter(
    (e) =>
      e.year === year &&
      e.source === "historical" &&
      historicalIds.has(e.ballot_id) &&
      (e.video_id != null || e.source_video_number != null),
  ).length;
  {
    const videos = new Map(works.map((w) => [w.video_id, w]));
    result.details = selectedEntries.map((e) => {
      const b = selectedBallots.get(e.ballot_id)!;
      const profile = b.voter_id ? profileMap.get(b.voter_id) : null;
      return {
        id: e.id,
        award_name: tallyAwards.find((a) => a.code === e.award_code)!.name,
        video_id: e.video_id,
        title:
          (e.video_id ? videos.get(e.video_id)?.title : null) ??
          e.source_video_label ??
          "作品選択なし",
        display_name: profile?.display_name ?? b.display_name ?? "未設定",
        nico_user_id: profile?.nico_user_id ?? b.nico_user_id ?? "",
        comment: e.comment ?? "",
        timestamp:
          actualSource === "historical" ? b.created_at : b.submitted_at,
        source_timestamp: b.source_timestamp,
      };
    });
  }
  result.detail_count = result.details?.length ?? 0;
  return result;
}
