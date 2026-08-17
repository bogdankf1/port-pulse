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

  it("tells the model not to emit markdown", () => {
    // MessageList has no markdown parser, so `**bold**` would render literally.
    // This instruction is the only thing preventing that.
    expect(buildSystemPrompt({ activePortfolioName: "Main" })).toMatch(
      /plain prose|markdown/i,
    );
  });
});
