import { z } from "zod";
import { apiAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { loadAdminYear } from "@/lib/admin-year-data";

export async function GET(request: Request) {
  return handle(async () => {
    const { db } = await apiAdmin();
    const input = z
      .object({
        year: z.coerce.number().int().min(2000).max(2100),
        kind: z.enum(["videos", "voters"]),
      })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    return loadAdminYear(db, input.year, input.kind);
  });
}
