import { apiUser } from "@/lib/auth";
import { checkOrigin, handle, jsonBody } from "@/lib/http";
import { profileSchema } from "@/lib/validation";
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiUser();
    const p = profileSchema.parse(await jsonBody(request));
    const { data, error } = await db.rpc("save_profile", {
      p_name: p.display_name,
      p_nico: p.nico_user_id,
    });
    if (error) throw error;
    return data;
  });
}
