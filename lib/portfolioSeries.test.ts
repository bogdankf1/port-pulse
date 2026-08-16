import { describe, expect, it } from "vitest";
import {
  alignedTimes,
  buildPortfolioSeries,
  computePortfolioValues,
  type HoldingHistory,
} from "./portfolioSeries";

function history(
  symbol: string,
  quantity: number,
  points: [number, number][],
): HoldingHistory {
  return {
    holding: { symbol, quantity },
    points: points.map(([time, value]) => ({ time, value })),
  };
}

describe("alignedTimes", () => {
  it("returns the union of timestamps at or after the latest start", () => {
    const a = history("A", 1, [[10, 1], [20, 2], [30, 3]]);
    const b = history("B", 1, [[20, 5], [30, 6]]);
    expect(alignedTimes([a, b])).toEqual([20, 30]);
  });

  it("deduplicates overlapping timestamps and returns them sorted", () => {
    // Interleaved so the Set fills out of order (20, 40, then 30, 50) —
    // this is what pins the final .sort(), not just the dedupe.
    const a = history("A", 1, [[20, 1], [40, 2]]);
    const b = history("B", 1, [[10, 5], [20, 6], [30, 7], [50, 8]]);
    // latestStart = max(20, 10) = 20, so t=10 drops; t=20 is in both and dedupes.
    expect(alignedTimes([a, b])).toEqual([20, 30, 40, 50]);
  });

  it("returns nothing for an empty input", () => {
    expect(alignedTimes([])).toEqual([]);
  });
});

describe("computePortfolioValues", () => {
  it("multiplies quantity by price and sums across holdings", () => {
    const a = history("A", 2, [[10, 100], [20, 110]]);
    const b = history("B", 3, [[10, 10], [20, 20]]);
    expect(computePortfolioValues([10, 20], [a, b])).toEqual([
      { time: 10, value: 230 },
      { time: 20, value: 280 },
    ]);
  });

  it("snaps to the most recent price at or before each time", () => {
    // B has no point at t=20, so its t=10 price carries forward.
    const a = history("A", 1, [[10, 100], [20, 200]]);
    const b = history("B", 1, [[10, 5], [30, 9]]);
    expect(computePortfolioValues([10, 20, 30], [a, b])).toEqual([
      { time: 10, value: 105 },
      { time: 20, value: 205 },
      { time: 30, value: 209 },
    ]);
  });

  it("skips times where a holding has no prior price", () => {
    const a = history("A", 1, [[10, 100], [20, 200]]);
    const b = history("B", 1, [[20, 5]]);
    // At t=10, B has nothing at or before it, so that point is dropped.
    expect(computePortfolioValues([10, 20], [a, b])).toEqual([
      { time: 20, value: 205 },
    ]);
  });

  it("drops an empty-points holding instead of losing the whole series", () => {
    const a = history("A", 1, [[10, 100], [20, 200]]);
    expect(computePortfolioValues([10, 20], [a, history("E", 5, [])])).toEqual([
      { time: 10, value: 100 },
      { time: 20, value: 200 },
    ]);
  });

  it("gives each history its own cursor, even when symbols repeat", () => {
    // Same symbol, different-length arrays. With symbol-keyed pointers the
    // longer history walked the shared cursor off the end of the shorter one.
    const long = history("A", 1, [[10, 100], [20, 200], [30, 300]]);
    const short = history("A", 1, [[10, 5]]);
    expect(computePortfolioValues([10, 20, 30], [long, short])).toEqual([
      { time: 10, value: 105 },
      { time: 20, value: 205 },
      { time: 30, value: 305 },
    ]);
  });

  it("drops a time where the total is not finite", () => {
    expect(
      computePortfolioValues([10], [history("A", Infinity, [[10, 5]])]),
    ).toEqual([]);
  });
});

describe("buildPortfolioSeries", () => {
  it("aligns then values in one call", () => {
    const a = history("A", 1, [[10, 100], [20, 200]]);
    const b = history("B", 2, [[20, 5], [30, 6]]);
    expect(buildPortfolioSeries([a, b])).toEqual([
      { time: 20, value: 210 },
      { time: 30, value: 212 },
    ]);
  });

  it("returns an empty series when no holding has history", () => {
    expect(buildPortfolioSeries([])).toEqual([]);
  });

  it("returns an empty series when a holding has no points", () => {
    expect(buildPortfolioSeries([history("A", 1, [])])).toEqual([]);
  });
});
