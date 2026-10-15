import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
// PostgREST's row cap must not silently truncate import impact calculations.
export async function adminRows<T>(
  db: SupabaseClient,
  table: "data_profiles" | "data_ballot" | "data_ballots",
  year?: number,
): Promise<T[]> {
  const rows: T[] = [];
  const order = table === "data_profiles" ? "user_id" : "id";
  for (let offset = 0; ; offset += 1000) {
    let query = db
      .from(table)
      .select("*")
      .order(order)
      .range(offset, offset + 999);
    if (year !== undefined && table !== "data_profiles")
      query = query.eq("year", year);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}
