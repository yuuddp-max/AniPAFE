import { z } from "zod";
import { apiAdmin, HttpError } from "@/lib/auth";
import { handle } from "@/lib/http";
import { csv } from "@/lib/validation";
import { loadTally } from "@/lib/tally-data";
import { tallyCsvRows } from "@/lib/tally";

export async function GET(request: Request) {
  return handle(async () => {
    const { db } = await apiAdmin();
    const input = z
      .object({
        type: z.enum(["ranking", "details"]),
        year: z.coerce.number().int().min(2000).max(2100),
        source: z.enum(["auto", "site", "historical"]).default("auto"),
      })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const { data: year, error } = await db
      .from("master_poll_settings")
      .select("year")
      .eq("year", input.year)
      .maybeSingle();
    if (error) throw error;
    if (!year) throw new HttpError(404, "年度が登録されていません。");
    const result = await loadTally(
      db,
      input.year,
      input.source,
      143,
      input.type === "details",
    );
    return new Response(csv(tallyCsvRows(result, input.type)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="anipafe${input.year}-${input.type}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
