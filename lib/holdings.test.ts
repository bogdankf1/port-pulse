import { describe, expect, it } from "vitest";
import {
  computeTotals,
  dayChange,
  dayChangePct,
  defaultDir,
  marketValue,
  sortTickers,
  unrealizedPl,
  weightPct,
  type Quotes,
} from "./holdings";
import type { Ticker } from "@/types";

const AAPL: Ticker = { symbol: "AAPL", name: "Apple Inc.", quantity: 10, entryPrice: 100 };
const MSFT: Ticker = { symbol: "MSFT", name: "Microsoft", quantity: 5, entryPrice: 200 };
const NVDA: Ticker = { symbol: "NVDA", name: "Nvidia", quantity: 4 }; // no entry price
const CASH: Ticker = { symbol: "CASH", name: "Cash" }; // no quantity

function quotes(entries: Record<string, [number | null, number | null]>): Quotes {
  return new Map(
    Object.entries(entries).map(([s, [price, prevClose]]) => [s, { price, prevClose }]),
  );
}

describe("per-holding maths", () => {
  const q = quotes({ AAPL: [150, 140], MSFT: [190, 200], NVDA: [50, 50] });

  it("computes market value, P&L and weight", () => {
    expect(marketValue(AAPL, q)).toBe(1500);
    expect(unrealizedPl(AAPL, q)).toBe(500);
    expect(weightPct(AAPL, q, 3000)).toBe(50);
  });

  it("returns null when quantity is unknown", () => {
    expect(marketValue(CASH, q)).toBeNull();
    expect(unrealizedPl(CASH, q)).toBeNull();
    expect(dayChange(CASH, q)).toBeNull();
  });

  it("returns null P&L when entry price is unknown", () => {
    expect(marketValue(NVDA, q)).toBe(200);
    expect(unrealizedPl(NVDA, q)).toBeNull();
  });

  it("computes day change in dollars and percent", () => {
    expect(dayChange(AAPL, q)).toBeCloseTo(100, 10);
    expect(dayChangePct(AAPL, q)).toBeCloseTo(7.142857, 5);
    expect(dayChange(MSFT, q)).toBeCloseTo(-50, 10);
    expect(dayChangePct(MSFT, q)).toBeCloseTo(-5, 10);
  });

  it("returns null day change when prev close is missing or zero", () => {
    expect(dayChange(AAPL, quotes({ AAPL: [150, null] }))).toBeNull();
    expect(dayChangePct(AAPL, quotes({ AAPL: [150, 0] }))).toBeNull();
  });

  it("returns null weight when the portfolio has no value", () => {
    expect(weightPct(AAPL, q, 0)).toBeNull();
  });
});

describe("computeTotals", () => {
  it("sums value, cost basis, P&L and day change", () => {
    const q = quotes({ AAPL: [150, 140], MSFT: [190, 200] });
    const t = computeTotals([AAPL, MSFT], q);
    expect(t.marketValue).toBe(2450);
    expect(t.costBasis).toBe(2000);
    expect(t.pl).toBe(450);
    expect(t.dayChange).toBeCloseTo(50, 10);
    // prev-close base is 10*140 + 5*200 = 2400
    expect(t.dayChangePct).toBeCloseTo((50 / 2400) * 100, 10);
    expect(t.hasAnyValue).toBe(true);
  });

  it("excludes holdings without an entry price from P&L on BOTH sides", () => {
    const q = quotes({ AAPL: [150, 140], NVDA: [50, 50] });
    const t = computeTotals([AAPL, NVDA], q);
    expect(t.marketValue).toBe(1700); // 1500 + 200 — full portfolio value
    expect(t.costBasis).toBe(1000); // AAPL only
    expect(t.pl).toBe(500); // NOT 700 — NVDA's value must not inflate P&L
  });

  it("returns null P&L when no holding has an entry price", () => {
    const t = computeTotals([NVDA], quotes({ NVDA: [50, 50] }));
    expect(t.pl).toBeNull();
  });

  it("returns null day change when no prev close is known", () => {
    const t = computeTotals([AAPL], quotes({ AAPL: [150, null] }));
    expect(t.dayChange).toBeNull();
    expect(t.dayChangePct).toBeNull();
  });

  it("reports no value for an unpriced portfolio", () => {
    const t = computeTotals([AAPL], quotes({}));
    expect(t.hasAnyValue).toBe(false);
    expect(t.marketValue).toBe(0);
  });
});

describe("sortTickers", () => {
  const q = quotes({ AAPL: [150, 140], MSFT: [190, 200], NVDA: [50, 50] });
  const ctx = { quotes: q, totalValue: 2450 };
  const all = [AAPL, MSFT, NVDA];

  it("returns the input untouched when there is no sort", () => {
    expect(sortTickers(all, null, ctx)).toBe(all);
  });

  it("does not mutate the input array", () => {
    const input = [...all];
    sortTickers(input, { column: "ticker", direction: "asc" }, ctx);
    expect(input).toEqual(all);
  });

  it("sorts by ticker alphabetically", () => {
    const out = sortTickers(all, { column: "ticker", direction: "asc" }, ctx);
    expect(out.map((t) => t.symbol)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("sorts by day change percent descending", () => {
    const out = sortTickers(all, { column: "day", direction: "desc" }, ctx);
    expect(out.map((t) => t.symbol)).toEqual(["AAPL", "NVDA", "MSFT"]);
  });

  it("sorts by value descending", () => {
    const out = sortTickers(all, { column: "value", direction: "desc" }, ctx);
    expect(out.map((t) => t.symbol)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("puts nulls last regardless of direction", () => {
    const withNull = [...all, CASH];
    const desc = sortTickers(withNull, { column: "value", direction: "desc" }, ctx);
    expect(desc[desc.length - 1].symbol).toBe("CASH");
    const asc = sortTickers(withNull, { column: "value", direction: "asc" }, ctx);
    expect(asc[asc.length - 1].symbol).toBe("CASH");
  });

  it("resolves names through nameFor when the ticker has none", () => {
    const anon: Ticker = { symbol: "ZZZ", name: "" };
    const out = sortTickers([anon, AAPL], { column: "name", direction: "asc" }, {
      ...ctx,
      nameFor: (s) => (s === "ZZZ" ? "Aardvark Corp" : undefined),
    });
    expect(out.map((t) => t.symbol)).toEqual(["ZZZ", "AAPL"]);
  });
});

describe("defaultDir", () => {
  it("defaults numeric columns to descending and text to ascending", () => {
    expect(defaultDir("value")).toBe("desc");
    expect(defaultDir("day")).toBe("desc");
    expect(defaultDir("ticker")).toBe("asc");
    expect(defaultDir("name")).toBe("asc");
  });
});
