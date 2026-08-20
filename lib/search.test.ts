import { describe, expect, it } from "vitest";
import { isTradableType } from "./search";

describe("isTradableType", () => {
  // The bug this guards: an allow-list of "Common Stock" dropped every ETF,
  // so SPY, VOO, VTI and QQQ returned "No matches" from the only manual add
  // path in the app — while lib/sectorMap.ts maps those exact tickers and
  // every risk metric benchmarks against SPY.
  it("accepts the fund types a portfolio actually holds", () => {
    expect(isTradableType("ETP")).toBe(true);
    expect(isTradableType("ETF")).toBe(true);
    expect(isTradableType("Closed-End Fund")).toBe(true);
    expect(isTradableType("REIT")).toBe(true);
    expect(isTradableType("ADR")).toBe(true);
  });

  it("still accepts common stock and an unstated type", () => {
    expect(isTradableType("Common Stock")).toBe(true);
    expect(isTradableType("")).toBe(true);
  });

  // Denied rather than allow-listed, so a type Finnhub adds later surfaces
  // instead of silently vanishing — which is exactly how ETFs went missing.
  it("rejects instruments that are not a holding", () => {
    expect(isTradableType("Warrant")).toBe(false);
    expect(isTradableType("Right")).toBe(false);
    expect(isTradableType("Unit")).toBe(false);
  });

  it("matches case-insensitively and ignores padding", () => {
    expect(isTradableType(" warrant ")).toBe(false);
    expect(isTradableType("etp")).toBe(true);
  });
});
