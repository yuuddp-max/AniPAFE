import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { checkOrigin, handle, jsonBody } from "@/lib/http";
import { entriesSchema } from "@/lib/validation";
const schema = z.object({
  entries: entriesSchema,
  revision: z.number().int().nonnegative(),
  year: z.number().int().min(2000).max(2100),
});
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiUser();
    const input = schema.parse(await jsonBody(request));
    const { data, error } = await db.rpc("save_draft", {
      p_entries: input.entries,
      p_revision: input.revision,
      p_year: input.year,
    });
    if (error) throw error;
    return data;
  });
}
