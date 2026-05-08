import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";

  if (code) {
    try {
      const supabase = await createServerSupabase();
      await supabase.auth.exchangeCodeForSession(code);
    } catch {
      return NextResponse.redirect(new URL("/?auth_error=1", url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
