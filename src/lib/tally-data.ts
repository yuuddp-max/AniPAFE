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
  const actualSource =
    source === "auto" ? (historical.length ? "historical" : "site") : source;
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
  const selectedEntries = entries.filter(
    (e) => selectedBallots.has(e.ballot_id) && e.source === actualSource,
  );
  const result: AdminTallyResult = {
    ...tally({
      year,
      source: actualSource,
      ballotCount: selectedBallots.size,
      works,
      entries: selectedEntries,
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
  if (includeDetails) {
    const profiles =
      actualSource === "site"
        ? await adminRows<Profile>(db, "data_profiles")
        : [];
    const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
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
  return result;
}
