import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { mcpContextFromSession } from "@/lib/assistant/context";
import { generateFollowUps, runAssistantTurn } from "@/lib/assistant/loop";
import { encodeEvent } from "@/lib/assistant/protocol";
import {
  appendMessage,
  createConversation,
  loadMessages,
} from "@/lib/assistant/persist";

export const runtime = "nodejs";
export const maxDuration = 120;

type RequestBody = {
  message?: unknown;
  conversationId?: unknown;
  activePortfolioName?: unknown;
};

/**
 * Best-effort guard against an accidental double-submit on a paid endpoint.
 *
 * Module state does not survive across serverless instances, so this is not a
 * rate limit and must not be mistaken for one — the disabled composer is the
 * real first line, and IDEAS #12 owns proper limiting.
 */
const inFlight = new Set<string>();

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  // `getUser()` validates the JWT against Supabase and is the authentication
  // step. `getSession()` only reads cookies, so on its own it authenticates
  // nothing — it is called purely for `access_token`.
  //
  // The order matters and is not interchangeable: `getUser()` first means an
  // expired token has already been refreshed by the time `getSession()` reads
  // it, so the token handed to the tools is the fresh one. Reversing these two
  // calls can hand the MCP layer a token that is about to expire mid-turn.
  //
  // No other route in this codebase calls `getSession()` — this is the first,
  // because it is the only place that needs the raw token rather than just the
  // identity.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  if (inFlight.has(user.id)) {
    return NextResponse.json(
      { error: "A message is already in progress" },
      { status: 409 },
    );
  }

  const activePortfolioName =
    typeof body.activePortfolioName === "string" &&
    body.activePortfolioName.trim()
      ? body.activePortfolioName.trim().slice(0, 80)
      : null;

  let conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;

  inFlight.add(user.id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));
      let assistantText = "";

      try {
        if (!conversationId) {
          conversationId = await createConversation(supabase, user.id, message);
        }
        await appendMessage(supabase, {
          conversationId,
          userId: user.id,
          role: "user",
          content: message,
        });

        const history = await loadMessages(supabase, conversationId);

        for await (const event of runAssistantTurn({
          ctx: mcpContextFromSession(user.id, session.access_token),
          history,
          activePortfolioName,
          signal: request.signal,
        })) {
          if (event.kind === "text") assistantText += event.delta;
          send(encodeEvent(event));
        }

        // Persist whatever was produced, even a partial answer — a dropped
        // stream should leave a visible transcript, not a gap.
        const messageId = assistantText
          ? await appendMessage(supabase, {
              conversationId,
              userId: user.id,
              role: "assistant",
              content: assistantText,
            })
          : "";

        // After the answer is committed, never before: the follow-ups describe
        // an exchange that has already happened, and a failure here must not
        // cost the user their answer.
        if (assistantText && !request.signal.aborted) {
          const questions = await generateFollowUps({
            question: message,
            answer: assistantText,
            signal: request.signal,
          });
          if (questions.length > 0) {
            send(encodeEvent({ kind: "followups", questions }));
          }
        }

        send(encodeEvent({ kind: "done", conversationId, messageId }));
      } catch (err) {
        send(
          encodeEvent({
            kind: "error",
            message:
              err instanceof Error ? err.message : "The assistant failed",
          }),
        );
      } finally {
        inFlight.delete(user.id);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
