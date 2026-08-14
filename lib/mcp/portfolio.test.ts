import { describe, expect, it } from "vitest";
import { buildPortfolioDetail } from "./portfolio";
import type { HoldingRow } from "./types";

const rows: HoldingRow[] = [
  { symbol: "AAPL", name: "Apple Inc.", quantity: 10, entry_price: 100 },
  { symbol: "MSFT", name: "Microsoft", quantity: 5, entry_price: 200 },
];

describe("buildPortfolioDetail", () => {
  it("computes market value, P&L and weights", () => {
    const result = buildPortfolioDetail(
      rows,
      new Map([
        ["AAPL", 150],
        ["MSFT", 300],
      ]),
    );

    expect(result.totals.market_value).toBe(3000);
    expect(result.totals.cost_basis).toBe(2000);
    expect(result.totals.unrealized_pnl).toBe(1000);

    const aapl = result.holdings[0];
    expect(aapl.market_value).toBe(1500);
    expect(aapl.unrealized_pnl).toBe(500);
    expect(aapl.unrealized_pnl_pct).toBe(50);
    expect(aapl.weight_pct).toBe(50);

    expect(result.missing_symbols).toEqual([]);
  });

  it("reports symbols with no price and excludes them from weights", () => {
    const result = buildPortfolioDetail(rows, new Map([["AAPL", 150]]));

    expect(result.missing_symbols).toEqual(["MSFT"]);
    expect(result.holdings[1].current_price).toBeNull();
    expect(result.holdings[1].market_value).toBeNull();
    expect(result.holdings[1].weight_pct).toBeNull();
    expect(result.holdings[0].weight_pct).toBe(100);
    expect(result.totals.market_value).toBe(1500);
  });

  it("returns null P&L when entry price is unknown", () => {
    const result = buildPortfolioDetail(
      [{ symbol: "AAPL", name: "Apple Inc.", quantity: 10, entry_price: null }],
      new Map([["AAPL", 150]]),
    );

    expect(result.holdings[0].market_value).toBe(1500);
    expect(result.holdings[0].unrealized_pnl).toBeNull();
    expect(result.holdings[0].unrealized_pnl_pct).toBeNull();
    expect(result.totals.cost_basis).toBeNull();
    expect(result.totals.unrealized_pnl).toBeNull();
  });

  it("returns null weights rather than NaN when total value is zero", () => {
    const result = buildPortfolioDetail(
      [{ symbol: "AAPL", name: "Apple Inc.", quantity: null, entry_price: null }],
      new Map(),
    );

    expect(result.totals.market_value).toBe(0);
    expect(result.holdings[0].weight_pct).toBeNull();
    expect(Number.isNaN(result.holdings[0].weight_pct ?? 0)).toBe(false);
  });
});
