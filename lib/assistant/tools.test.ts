import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key";

const { assistantTools, TOOL_NAMES } = await import("./tools");

const CTX = {
  userId: "u1",
  token: "tok",
  clientId: "port-pulse-app",
  scopes: [] as string[],
};

/** The `tools` parameter of the overload `lib/assistant/loop.ts` actually calls. */
type ToolRunnerTools = Parameters<
  Anthropic["beta"]["messages"]["toolRunner"]
>[0]["tools"];

describe("assistantTools", () => {
  it("stays assignable to toolRunner's tools parameter", () => {
    // This is a COMPILE-time guard wearing a runtime test's clothes. The
    // annotation is the assertion; the expect() below is incidental.
    //
    // It exists because this broke once and nothing caught it: the local
    // zodTool's `input_schema.type` widened away from the literal "object" that
    // `BetaTool.InputSchema` demands, so the whole array was unassignable. No
    // runtime test can see that, and the only real call site is in loop.ts —
    // so the error surfaced far from its cause. Keep this next to the code it
    // constrains.
    const tools: ToolRunnerTools = assistantTools(CTX);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("exposes exactly the expected read-only tools", () => {
    // Listed explicitly rather than counted: a tool silently disappearing from
    // the bind is a capability regression the model cannot report.
    const names = assistantTools(CTX).map((t) => t.name).sort();
    expect(names).toEqual([
      "calculate",
      "compare_portfolios",
      "convert_currency",
      "get_company_fundamentals",
      "get_correlation",
      "get_earnings_calendar",
      "get_balances",
      "get_market_context",
      "get_portfolio",
      "get_portfolio_history",
      "get_position",
      "get_price_history",
      "get_risk_metrics",
      "get_sector_breakdown",
      "search_symbol",
      "list_portfolios",
    ].sort());
  });

  it("keeps TOOL_NAMES in step with the definitions", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      assistantTools(CTX).map((t) => t.name).sort(),
    );
  });

  it("gives every tool a non-trivial description", () => {
    // These are what the model reads to decide when to call a tool. A stub
    // description is a silent capability regression.
    for (const tool of assistantTools(CTX)) {
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it("exposes no tool that could mutate state", () => {
    // The app is read-only by design. Assert it structurally rather than
    // trusting that nobody adds a write tool later.
    const forbidden = /add|create|update|delete|remove|set|buy|sell|place|order/i;
    for (const name of TOOL_NAMES) {
      expect(name).not.toMatch(forbidden);
    }
  });
});
