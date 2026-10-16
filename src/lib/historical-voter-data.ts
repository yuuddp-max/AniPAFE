import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminPoll } from "./admin-year-data";
import type { Profile } from "./types";
import type {
  HistoricalVoter,
  HistoricalVoterData,
} from "./historical-voter-types";

type Link = {
  ballot_id: string;
  user_id: string | null;
  revision: number;
  updated_at: string;
};

export async function loadHistoricalVoters(
  db: SupabaseClient,
  year: number,
): Promise<HistoricalVoterData> {
  await adminPoll(db, year);
  async function rows<T>(
    table: string,
    fields: string,
    order: string,
    scoped: boolean,
  ) {
    const result: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = db
        .from(table)
        .select(fields)
        .order(order)
        .range(offset, offset + 999);
      if (scoped) query = query.eq("year", year);
      if (table === "data_ballot") query = query.eq("source", "historical");
      const { data, error } = await query;
      if (error) throw error;
      result.push(...((data ?? []) as unknown as T[]));
      if ((data?.length ?? 0) < 1000) return result;
    }
  }
  const [voters, users, links] = await Promise.all([
    rows<HistoricalVoter>(
      "data_ballot",
      "id,source_row,display_name,nico_user_id,source_timestamp",
      "id",
      true,
    ),
    rows<Profile>(
      "data_login_user",
      "user_id,display_name,nico_user_id",
      "user_id",
      false,
    ),
    rows<Link>(
      "data_historical_voter_links",
      "ballot_id,user_id,revision,updated_at",
      "ballot_id",
      true,
    ),
  ]);
  const byBallot = new Map(links.map((link) => [link.ballot_id, link]));
  return {
    year,
    users,
    voters: voters
      .map((voter) => {
        const link = byBallot.get(voter.id);
        return {
          ...voter,
          user_id: link?.user_id ?? null,
          link_revision: link?.revision ?? 0,
          linked_at: link?.updated_at ?? null,
        };
      })
      .toSorted(
        (a, b) => a.source_row - b.source_row || a.id.localeCompare(b.id),
      ),
  };
}
