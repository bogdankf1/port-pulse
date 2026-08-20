import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import {
  deleteConversation,
  listConversations,
  loadMessages,
} from "@/lib/assistant/persist";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { supabase, error: authError } = await requireUser();
  if (authError) return authError;

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

export async function DELETE(request: Request) {
  const { supabase, error: authError } = await requireUser();
  if (authError) return authError;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await deleteConversation(supabase, id);
  return new NextResponse(null, { status: 204 });
}
