import { z } from "zod";
import { apiAdmin, HttpError } from "@/lib/auth";
import { handle } from "@/lib/http";
import { loadTally } from "@/lib/tally-data";
import { tallyCsvRows } from "@/lib/tally";
import { csv } from "@/lib/validation";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  source: z.enum(["site", "historical"]),
  denominator: z.coerce.number().int().min(1).max(100000).default(143),
  format: z.enum(["json", "ranking", "score", "details"]).default("json"),
  include_details: z.enum(["0", "1"]).default("0"),
});
export async function GET(request: Request) {
  return handle(async () => {
    const { db } = await apiAdmin();
    const input = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
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
      input.denominator,
      input.include_details === "1" || input.format === "details",
    );
    if (input.format === "json") return result;
    return new Response(csv(tallyCsvRows(result, input.format)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="anipafe${input.year}-${input.source}-${input.format}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
