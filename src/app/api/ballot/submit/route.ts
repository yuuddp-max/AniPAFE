import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { checkOrigin, handle, jsonBody } from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiUser();
    const { revision, year } = z
      .object({
        revision: z.number().int().nonnegative(),
        year: z.number().int().min(2000).max(2100),
      })
      .parse(await jsonBody(request));
    const { data, error } = await db.rpc("submit_ballot", {
      p_revision: revision,
      p_year: year,
    });
    if (error) throw error;
    return data;
  });
}
