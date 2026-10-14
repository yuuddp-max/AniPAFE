import "server-only";
import { redirect } from "next/navigation";
import { configured, supabase } from "./supabase/server";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function identity() {
  if (!configured()) return null;
  const db = await supabase();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user || !user.identities?.some((i) => i.provider === "google"))
    return null;
  return { db, user };
}
export async function pageUser() {
  const auth = await identity();
  if (!auth) redirect("/login");
  return auth;
}
export async function apiUser() {
  const auth = await identity();
  if (!auth) throw new HttpError(401, "Googleログインが必要です。");
  return auth;
}
export async function apiAdmin() {
  const auth = await apiUser();
  const { data, error } = await auth.db
    .from("admin_users")
    .select("auth_user_id")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (error || !data) throw new HttpError(403, "運営者権限が必要です。");
  return auth;
}
