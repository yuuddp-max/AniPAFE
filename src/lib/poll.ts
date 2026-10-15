import "server-only";
import { cache } from "react";
import { configured, supabase } from "./supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Poll } from "./types";

export const pollHeader = cache(
  async (): Promise<Pick<Poll, "year" | "title">> => {
    if (!configured()) return { year: 2026, title: "AniPAFE2026 人気投票" };
    const db = await supabase();
    const { data, error } = await db.rpc("poll_header");
    if (error || !data)
      throw new Error("対象年度の設定を取得できませんでした。");
    return data;
  },
);

export async function currentPoll(db: SupabaseClient): Promise<Poll> {
  const { year } = await pollHeader();
  const { data, error } = await db
    .from("master_poll_settings")
    .select("*")
    .eq("year", year)
    .single();
  if (error || !data) throw new Error("投票設定を取得できませんでした。");
  return data;
}
