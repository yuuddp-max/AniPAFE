import { NextResponse } from "next/server";
import { configured, supabase } from "@/lib/supabase/server";
import { checkOrigin, handle } from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    if (!configured())
      return NextResponse.redirect(
        new URL("/login?error=configuration", request.url),
        303,
      );
    const db = await supabase();
    const { data, error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${new URL(process.env.APP_ORIGIN!).origin}/auth/callback`,
        scopes: "openid email profile",
      },
    });
    if (error || !data.url)
      return NextResponse.redirect(
        new URL("/login?error=oauth", request.url),
        303,
      );
    return NextResponse.redirect(data.url, 303);
  });
}
