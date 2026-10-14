import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
// PostgREST's row cap must not silently truncate import impact calculations.
export async function adminRows<T>(
  db: SupabaseClient,
  table: "profiles" | "ballots" | "ballot_entries",
): Promise<T[]> {
  const rows: T[] = [];
  const order = table === "profiles" ? "user_id" : "id";
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(order)
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}
