import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
// PostgREST's row cap must not silently truncate import impact calculations.
export async function adminRows<T>(
  db: SupabaseClient,
  table: "data_login_user" | "data_ballot" | "data_ballots" | "data_mad",
  year?: number,
): Promise<T[]> {
  const rows: T[] = [];
  const order =
    table === "data_login_user"
      ? "user_id"
      : table === "data_mad"
        ? "video_id"
        : "id";
  for (let offset = 0; ; offset += 1000) {
    let query = db
      .from(table)
      .select("*")
      .order(order)
      .range(offset, offset + 999);
    if (year !== undefined && table !== "data_login_user")
      query = query.eq("year", year);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}
