import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { checkOrigin, handle, jsonBody } from "@/lib/http";
import { entriesSchema } from "@/lib/validation";
const schema = z.object({
  entries: entriesSchema,
  revision: z.number().int().nonnegative(),
});
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiUser();
    const input = schema.parse(await jsonBody(request));
    const { data, error } = await db.rpc("save_draft", {
      p_entries: input.entries,
      p_revision: input.revision,
    });
    if (error) throw error;
    return data;
  });
}
