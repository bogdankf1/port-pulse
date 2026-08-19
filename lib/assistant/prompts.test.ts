import { describe, expect, it } from "vitest";
import { STARTER_PROMPTS, buildSystemPrompt, pickStarters } from "./prompts";

describe("STARTER_PROMPTS", () => {
  it("has 15 unique prompts", () => {
    expect(STARTER_PROMPTS).toHaveLength(15);
    expect(new Set(STARTER_PROMPTS).size).toBe(15);
  });

  it("asks no prompt that solicits a transaction", () => {
    // The app is analysis-only; a starter that invites trade advice would be
    // the product contradicting its own constraint on the first screen.
    const forbidden = /should i (buy|sell)|what should i buy|place an order/i;
    for (const p of STARTER_PROMPTS) expect(p).not.toMatch(forbidden);
  });
});

describe("pickStarters", () => {
  it("returns the requested count, without repeats", () => {
    const picked = pickStarters(3, () => 0.5);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it("only returns real prompts", () => {
    for (const p of pickStarters(3, () => 0.1)) {
      expect(STARTER_PROMPTS).toContain(p);
    }
  });

  it("varies with the random source", () => {
    const a = pickStarters(3, () => 0);
    const b = pickStarters(3, () => 0.99);
    expect(a).not.toEqual(b);
  });

  it("clamps a count larger than the pool", () => {
    expect(pickStarters(99, () => 0.5)).toHaveLength(15);
  });
});

describe("buildSystemPrompt", () => {
  it("names the portfolio the user is looking at", () => {
    expect(buildSystemPrompt({ activePortfolioName: "Main" })).toContain("Main");
  });

  it("works without an active portfolio", () => {
    const p = buildSystemPrompt({ activePortfolioName: null });
    expect(p.length).toBeGreaterThan(100);
    expect(p).not.toContain("null");
  });

  it("states the read-only boundary and forbids remembered numbers", () => {
    const p = buildSystemPrompt({ activePortfolioName: "Main" });
    expect(p).toMatch(/never place|do not place|read-only|analysis only/i);
    // Prices move between turns; a number recalled from an earlier turn is a
    // wrong number. This instruction is load-bearing, not decoration.
    expect(p).toMatch(/tool/i);
  });

  it("tells the model to format with markdown", () => {
    // MessageList renders through lib/markdown.ts. The prompt and the renderer
    // have to agree: an instruction to write plain prose would waste it, and
    // no instruction at all leaves formatting to chance.
    const p = buildSystemPrompt({ activePortfolioName: "Main" });
    expect(p).toMatch(/renders markdown/i);
    expect(p).not.toMatch(/plain prose/i);
  });

  it("keeps tickers unmarked so they can be linked", () => {
    // A ticker wrapped in backticks parses to a code span, which the entity
    // linker deliberately does not descend into.
    expect(buildSystemPrompt({ activePortfolioName: "Main" })).toMatch(
      /never inside backticks/i,
    );
  });
});

describe("buildSystemPrompt — web search grounding", () => {
  const prompt = buildSystemPrompt({ activePortfolioName: "Main" });

  it("treats search results as data, not instructions", () => {
    // Search returns third-party text straight into the context window. Without
    // this the model has no stated reason to ignore an instruction embedded in
    // a page it fetched.
    expect(prompt).toMatch(/never an\s*"?\s*instruction to follow|instruction to follow/i);
  });

  it("keeps the user's own figures off the web", () => {
    // The grounding rule is what stops a scraped number being presented as the
    // user's position.
    expect(prompt).toMatch(/never a source for the/i);
    expect(prompt).toMatch(/come from the tools/i);
  });

  it("routes arithmetic through the calculate tool", () => {
    expect(prompt).toMatch(/calculate tool rather than in your head/i);
  });
});
