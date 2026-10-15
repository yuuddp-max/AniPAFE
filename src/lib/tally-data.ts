import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminRows } from "./admin-data";
import { tally, type TallyEntry, type TallyWork } from "./tally";

export type TallyBallot = {
  id: string;
  year: number;
  source: string;
  status: string;
};
export type StoredTallyEntry = TallyEntry & {
  ballot_id: string;
  source: string;
};

// Kept separate from public rankings: imported forms remain unadopted originals.
export async function loadTally(
  db: SupabaseClient,
  year: number,
  source: "site" | "historical",
  scoreDenominator: number,
) {
  const [works, ballots, entries] = await Promise.all([
    adminRows<TallyWork>(db, "data_mad", year),
    adminRows<TallyBallot>(db, "data_ballot", year),
    adminRows<StoredTallyEntry>(db, "data_ballots", year),
  ]);
  const eligible = new Set(
    ballots
      .filter(
        (b) =>
          b.year === year &&
          b.source === source &&
          b.status === (source === "site" ? "submitted" : "imported"),
      )
      .map((b) => b.id),
  );
  return tally({
    year,
    source,
    ballotCount: eligible.size,
    works,
    entries: entries.filter(
      (e) => eligible.has(e.ballot_id) && e.source === source,
    ),
    scoreDenominator,
  });
}
