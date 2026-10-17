import { apiAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";

export async function GET() {
  return handle(async () => {
    const { db } = await apiAdmin();
    const { data, error } = await db
      .from("audit_logs")
      .select("id,action,target,created_at,summary")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return data ?? [];
  });
}
