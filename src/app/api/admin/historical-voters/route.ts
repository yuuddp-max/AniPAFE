import { z } from "zod";
import { apiAdmin } from "@/lib/auth";
import { checkOrigin, handle, jsonBody } from "@/lib/http";
import { loadHistoricalVoters } from "@/lib/historical-voter-data";

const year = z.number().int().min(2000).max(2100);
export async function GET(request: Request) {
  return handle(async () => {
    const { db } = await apiAdmin();
    const selected = year.parse(
      Number(new URL(request.url).searchParams.get("year")),
    );
    return loadHistoricalVoters(db, selected);
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiAdmin();
    const input = z
      .object({
        year,
        ballot_id: z.uuid(),
        user_id: z.uuid().nullable(),
        revision: z.number().int().nonnegative(),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(await jsonBody(request));
    const { data, error } = await db.rpc("admin_link_historical_voter", {
      p_ballot: input.ballot_id,
      p_year: input.year,
      p_user: input.user_id,
      p_revision: input.revision,
      p_reason: input.reason,
    });
    if (error) throw error;
    return { ok: true, result: data };
  });
}
