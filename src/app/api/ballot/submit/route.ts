import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { checkOrigin, handle, jsonBody } from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiUser();
    const { revision } = z
      .object({ revision: z.number().int().nonnegative() })
      .parse(await jsonBody(request));
    const { data, error } = await db.rpc("submit_ballot", {
      p_revision: revision,
    });
    if (error) throw error;
    return data;
  });
}
