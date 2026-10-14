import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code");
  const origin = process.env.APP_ORIGIN
    ? new URL(process.env.APP_ORIGIN).origin
    : url.origin;
  if (code) {
    const db = await supabase();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/profile`);
  }
  return NextResponse.redirect(`${origin}/login?error=callback`);
}
