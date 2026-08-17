import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { McpAuthContext } from "@/lib/mcp/auth";
import { assistantTools } from "./tools";
import { buildSystemPrompt } from "./prompts";
import type { AssistantEvent } from "./protocol";
import type { AssistantMessage } from "@/types";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 8192;

const client = new Anthropic();

/**
 * Run one assistant turn, yielding protocol events as they happen.
 *
 * Yields `tool` events because a tool loop plus thinking means several seconds
 * before the first token; without them the user watches a blank pane.
 *
 * The returned generator also accumulates the assistant's text, which the
 * caller persists — see the `text` events it emits.
 */
export async function* runAssistantTurn(args: {
  ctx: McpAuthContext;
  history: AssistantMessage[];
  activePortfolioName: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<AssistantEvent> {
  const runner = client.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      // Adaptive thinking is on by default on Opus 5, so there is no `thinking`
      // param here — `budget_tokens` is rejected outright on this model. High
      // effort is what buys multi-step tool reasoning ("compare these two
      // portfolios" is several dependent calls, not one).
      output_config: { effort: "high" },
      system: [
        {
          type: "text",
          text: buildSystemPrompt({
            activePortfolioName: args.activePortfolioName,
          }),
          // Tools serialize before `system`, which serializes before the
          // messages, so one breakpoint here caches the whole stable prefix —
          // measured at ~975 tokens (2442 chars of tool definitions + 1068 of
          // system prompt), comfortably clear of this model's 512-token
          // minimum. It pays on every turn after the first.
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: assistantTools(args.ctx),
      messages: args.history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      // Opus 5 can decline via its safety classifiers. Routing the retry
      // server-side means a decline is recovered rather than shown as a dead end.
      //
      // `fallbacks` appears nowhere in @anthropic-ai/sdk 0.95.1's resource
      // types, so it is introduced by spread rather than by asserting the whole
      // params object. Spread properties skip TypeScript's excess-property
      // check, which keeps every field above fully type-checked; a blanket
      // `as Parameters<typeof client.beta.messages.toolRunner>[0]` would have
      // suppressed errors on `tools`, `system` and `messages` as well.
      ...{ fallbacks: "default" },
    },
    {
      // The beta rides the header rather than a body `betas` key.
      // `BetaToolRunnerParams` derives from the **non-beta**
      // `MessageCreateParams` (BetaToolRunner.d.ts:144) so it has no `betas`
      // field — but `BetaToolRunnerRequestOptions` is
      // `Pick<RequestOptions, 'headers' | 'signal'>`, so this is fully typed.
      headers: { "anthropic-beta": "server-side-fallback-2026-07-01" },
      signal: args.signal,
    },
  );

  // Tools named in one model turn have been executed by the time the next turn
  // begins — that is when we can honestly report them done.
  let pending: string[] = [];

  for await (const messageStream of runner) {
    for (const name of pending) {
      yield { kind: "tool", name, status: "done" };
    }
    pending = [];

    for await (const event of messageStream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { kind: "text", delta: event.delta.text };
      }
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        pending.push(event.content_block.name);
        yield { kind: "tool", name: event.content_block.name, status: "running" };
      }
    }

    const message = await messageStream.finalMessage();
    // Check before trusting content: a refused message can be empty.
    if (message.stop_reason === "refusal") {
      yield {
        kind: "error",
        message:
          "I can't help with that one. Try rephrasing, or ask about a different part of the portfolio.",
      };
      return;
    }
  }

  for (const name of pending) {
    yield { kind: "tool", name, status: "done" };
  }
}
