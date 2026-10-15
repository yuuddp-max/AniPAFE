import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./auth";
import { adminRows } from "./admin-data";
import type { AdminYearData, AdminVoter, Poll, Profile, Video } from "./types";

export async function adminPoll(
  db: SupabaseClient,
  year: number,
): Promise<Poll> {
  const { data, error } = await db
    .from("master_poll_settings")
    .select("*")
    .eq("year", year)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "年度が登録されていません。");
  return data;
}

export async function loadAdminYear(
  db: SupabaseClient,
  year: number,
  kind: "videos" | "voters",
): Promise<AdminYearData> {
  const poll = await adminPoll(db, year);
  if (kind === "videos") {
    const videos = await adminRows<Video>(db, "data_mad", year);
    return {
      kind,
      year,
      master_revision: poll.master_revision,
      videos: videos.toSorted((a, b) => a.display_order - b.display_order),
    };
  }
  const [ballots, profiles] = await Promise.all([
    adminRows<
      AdminVoter & { id: string; year: number; raw_response?: unknown }
    >(db, "data_ballot", year),
    adminRows<Profile>(db, "data_profiles"),
  ]);
  const byId = new Map(profiles.map((p) => [p.user_id, p]));
  const voters = ballots.map((b) => {
    const profile =
      b.source === "site" && b.voter_id ? byId.get(b.voter_id) : null;
    return {
      ballot_id: b.id,
      voter_id: b.voter_id,
      source: b.source,
      status: b.status,
      display_name: profile?.display_name ?? b.display_name ?? "未設定",
      nico_user_id: profile?.nico_user_id ?? b.nico_user_id ?? "",
    };
  });
  return { kind, year, voters };
}
