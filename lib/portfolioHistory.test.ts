import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchYahooChart = vi.fn();

vi.mock("./yahoo", () => ({
  fetchYahooChart: (...args: unknown[]) => fetchYahooChart(...args),
  YahooFetchError: class YahooFetchError extends Error {
    status = 502;
  },
}));

const { buildPortfolioHistory, isPortfolioHistoryRange, sanitizeHoldings } =
  await import("./portfolioHistory");

beforeEach(() => {
  fetchYahooChart.mockReset();
});

describe("isPortfolioHistoryRange", () => {
  it("accepts the supported ranges", () => {
    for (const r of ["1D", "1M", "3M", "YTD", "1Y"]) {
      expect(isPortfolioHistoryRange(r)).toBe(true);
    }
  });

  it("rejects 5Y, unknown strings and non-strings", () => {
    expect(isPortfolioHistoryRange("5Y")).toBe(false);
    expect(isPortfolioHistoryRange("1W")).toBe(false);
    expect(isPortfolioHistoryRange(null)).toBe(false);
    expect(isPortfolioHistoryRange(1)).toBe(false);
  });
});

describe("sanitizeHoldings", () => {
  it("keeps well-formed holdings and upper-cases symbols", () => {
    expect(sanitizeHoldings([{ symbol: "aapl", quantity: 3 }])).toEqual([
      { symbol: "AAPL", quantity: 3 },
    ]);
    // Padding must be trimmed, not silently dropped — " AAPL " fails SYMBOL_RE.
    expect(sanitizeHoldings([{ symbol: " aapl ", quantity: 3 }])).toEqual([
      { symbol: "AAPL", quantity: 3 },
    ]);
  });

  it("drops bad symbols, bad quantities and non-objects", () => {
    const out = sanitizeHoldings([
      { symbol: "TOOLONGSYM", quantity: 1 },
      { symbol: "AAPL", quantity: 0 },
      { symbol: "AAPL", quantity: -2 },
      { symbol: "AAPL", quantity: Number.NaN },
      { symbol: "AAPL" },
      { quantity: 5 },
      "nope",
      null,
      { symbol: "MSFT", quantity: 2 },
    ]);
    expect(out).toEqual([{ symbol: "MSFT", quantity: 2 }]);
  });

  it("returns nothing for a non-array", () => {
    expect(sanitizeHoldings(undefined)).toEqual([]);
    expect(sanitizeHoldings({})).toEqual([]);
  });

  it("caps at 60 holdings", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      symbol: "AAPL",
      quantity: i + 1,
    }));
    expect(sanitizeHoldings(many)).toHaveLength(60);
  });
});

describe("buildPortfolioHistory", () => {
  it("values the portfolio over the aligned timeline", async () => {
    fetchYahooChart.mockImplementation(async (symbol: string) => {
      if (symbol === "AAPL") {
        return { points: [{ time: 10, value: 100 }, { time: 20, value: 110 }] };
      }
      return { points: [{ time: 10, value: 10 }, { time: 20, value: 20 }] };
    });

    const result = await buildPortfolioHistory(
      [
        { symbol: "AAPL", quantity: 2 },
        { symbol: "MSFT", quantity: 3 },
      ],
      "1M",
    );

    expect(result.range).toBe("1M");
    expect(result.points).toEqual([
      { time: 10, value: 230 },
      { time: 20, value: 280 },
    ]);
    expect(result.startValue).toBe(230);
    expect(result.endValue).toBe(280);
    expect(result.missing_symbols).toEqual([]);
    expect(result.caveat).toContain("current holdings");
    expect(result.caveat).toContain("buys and sells");
  });

  it("reports symbols whose history could not be fetched and excludes them", async () => {
    fetchYahooChart.mockImplementation(async (symbol: string) => {
      if (symbol === "AAPL") {
        return { points: [{ time: 10, value: 100 }, { time: 20, value: 110 }] };
      }
      throw new Error("upstream down");
    });

    const result = await buildPortfolioHistory(
      [
        { symbol: "AAPL", quantity: 2 },
        { symbol: "MSFT", quantity: 3 },
      ],
      "1M",
    );

    expect(result.missing_symbols).toEqual(["MSFT"]);
    expect(result.points).toEqual([
      { time: 10, value: 200 },
      { time: 20, value: 220 },
    ]);
  });

  it("treats an empty point list as a missing symbol", async () => {
    fetchYahooChart.mockResolvedValue({ points: [] });
    const result = await buildPortfolioHistory(
      [{ symbol: "AAPL", quantity: 2 }],
      "1D",
    );
    expect(result.missing_symbols).toEqual(["AAPL"]);
    expect(result.points).toEqual([]);
    expect(result.startValue).toBeNull();
    expect(result.endValue).toBeNull();
  });

  it("fetches each unique symbol once", async () => {
    fetchYahooChart.mockResolvedValue({
      points: [{ time: 10, value: 100 }],
    });
    const result = await buildPortfolioHistory(
      [
        { symbol: "AAPL", quantity: 1 },
        { symbol: "AAPL", quantity: 2 },
      ],
      "1M",
    );
    expect(fetchYahooChart).toHaveBeenCalledTimes(1);
    expect(result.points).toEqual([{ time: 10, value: 300 }]);
  });
});
