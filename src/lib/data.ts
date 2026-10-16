import "server-only";
import { redirect } from "next/navigation";
import { pageUser } from "./auth";
import type { VoteData } from "./types";
import { currentPoll } from "./poll";
export async function voteData(): Promise<VoteData> {
  const { db, user } = await pageUser();
  const poll = await currentPoll(db);
  const results = await Promise.all([
    db.from("data_login_user").select("*").eq("user_id", user.id).maybeSingle(),
    db.from("master_award_types").select("*").order("display_order"),
    db
      .from("data_mad")
      .select("*")
      .eq("is_active", true)
      .eq("year", poll.year)
      .order("display_order"),
    db
      .from("data_ballot")
      .select("*")
      .eq("voter_id", user.id)
      .eq("year", poll.year)
      .maybeSingle(),
    db
      .from("master_admin_users")
      .select("auth_user_id")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
  ]);
  for (const result of results)
    if (result.error)
      throw new Error(
        "データ取得に失敗しました。Supabaseの設定をご確認ください。",
      );
  if (!results[0].data) redirect("/profile");
  const ballot = results[3].data;
  const entries = ballot
    ? await db
        .from("data_ballots")
        .select("award_code,video_id,comment")
        .eq("ballot_id", ballot.id)
    : { data: [], error: null };
  if (entries.error) throw new Error("投票内容を取得できませんでした。");
  return {
    profile: results[0].data,
    awards: results[1].data ?? [],
    videos: results[2].data ?? [],
    ballot,
    entries: (entries.data ?? []).map((e) => ({
      ...e,
      comment: e.comment ?? "",
    })),
    poll,
    isAdmin: !!results[4].data,
  };
}
