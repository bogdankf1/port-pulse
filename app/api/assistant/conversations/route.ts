import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { listConversations, loadMessages } from "@/lib/assistant/persist";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    return NextResponse.json(
      { messages: await loadMessages(supabase, id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { conversations: await listConversations(supabase) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
