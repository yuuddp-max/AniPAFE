import { z } from "zod";
import { apiAdmin, HttpError } from "@/lib/auth";
import { checkOrigin, handle } from "@/lib/http";
import { loadTally, loadTallyDetailPage } from "@/lib/tally-data";
import { tallyAwards, tallyCsvRows } from "@/lib/tally";
import { csv } from "@/lib/validation";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  source: z.enum(["auto", "site", "historical"]).default("auto"),
  denominator: z.coerce.number().int().min(1).max(100000).default(143),
  format: z
    .enum(["json", "ranking", "score", "details", "detail-page"])
    .default("json"),
  page: z.coerce.number().int().min(0).max(100000).default(0),
  q: z.string().trim().max(200).default(""),
  award: z
    .enum(["", "overall", "music", "composition", "humor", "creative", "theme"])
    .default(""),
  comments_only: z.enum(["0", "1"]).default("0"),
  calculated_at: z.iso.datetime({ offset: true }).optional(),
  include_details: z.enum(["0", "1"]).default("0"),
});
export async function GET(request: Request) {
  return respond(request, false);
}
export async function POST(request: Request) {
  return respond(request, true);
}
function respond(request: Request, force: boolean) {
  return handle(async () => {
    if (force) checkOrigin(request);
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
    if (input.format === "detail-page") {
      if (force || input.source === "auto" || !input.calculated_at)
        throw new HttpError(400, "明細の取得条件が不正です。");
      return loadTallyDetailPage(
        db,
        input.year,
        input.source,
        input.denominator,
        input.page,
        input.calculated_at,
        {
          query: input.q,
          awardName:
            tallyAwards.find((a) => a.code === input.award)?.name ?? "",
          commentsOnly: input.comments_only === "1",
        },
      );
    }
    const result = await loadTally(
      db,
      input.year,
      input.source,
      input.denominator,
      input.include_details === "1" || input.format === "details",
      force,
    );
    if (input.format === "json") return result;
    return new Response(csv(tallyCsvRows(result, input.format)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="anipafe${input.year}-${result.source}-${input.format}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
