import { z } from "zod";
import { apiAdmin, HttpError } from "@/lib/auth";
import { handle } from "@/lib/http";
import { csv } from "@/lib/validation";
import { currentPoll } from "@/lib/poll";
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
    const poll = await currentPoll(db);
    if (input.year !== poll.year)
      throw new HttpError(
        409,
        "対象年度が変更されました。再読み込みしてください。",
      );
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
