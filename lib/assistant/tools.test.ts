import { describe, expect, it, vi } from "vitest";

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

describe("assistantTools", () => {
  it("exposes exactly the six read-only MCP tools", () => {
    const names = assistantTools(CTX).map((t) => t.name).sort();
    expect(names).toEqual([
      "get_portfolio",
      "get_position",
      "get_price_history",
      "get_risk_metrics",
      "get_sector_breakdown",
      "list_portfolios",
    ]);
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
