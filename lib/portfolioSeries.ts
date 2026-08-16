import type { HistoryPoint } from "@/types";

export type SeriesHolding = { symbol: string; quantity: number };
export type HoldingHistory = {
  holding: SeriesHolding;
  /**
   * Must be ascending by `time`. Both `alignedTimes` (which reads `points[0]`
   * as the earliest) and `computePortfolioValues` (whose pointer walk only
   * moves forward) depend on this. Unsorted input produces a silently wrong
   * series, not an error. Yahoo returns chart points ascending, which is why
   * neither function sorts defensively.
   */
  points: HistoryPoint[];
};
export type SeriesPoint = { time: number; value: number };

/**
 * Union of every timestamp at or after the latest first-point across holdings.
 *
 * Anchoring on the latest start means a recently-listed symbol truncates the
 * series rather than silently valuing the portfolio as if it did not exist.
 */
export function alignedTimes(histories: HoldingHistory[]): number[] {
  const usable = histories.filter((h) => h.points.length > 0);
  if (usable.length === 0) return [];

  const latestStart = usable.reduce(
    (acc, h) => Math.max(acc, h.points[0].time),
    0,
  );

  const times = new Set<number>();
  for (const h of usable) {
    for (const p of h.points) {
      if (p.time >= latestStart) times.add(p.time);
    }
  }
  return Array.from(times).sort((a, b) => a - b);
}

/**
 * Value the holding set at each time, using each symbol's most recent price at
 * or before that time. A time where any holding has no prior price is dropped,
 * so the series never mixes a partial portfolio with a full one.
 */
export function computePortfolioValues(
  times: number[],
  histories: HoldingHistory[],
): SeriesPoint[] {
  const usable = histories.filter((h) => h.points.length > 0);
  if (usable.length === 0) return [];

  // Keyed by position, not symbol: each HoldingHistory entry gets its own
  // cursor. `i` starts at 0 and only advances while `i + 1 < points.length`,
  // so it stays in range by construction — no entry can walk another's
  // cursor past its own array's end.
  const pointers: number[] = new Array(usable.length).fill(0);

  const out: SeriesPoint[] = [];
  for (const t of times) {
    let total = 0;
    let allPriced = true;
    for (let h = 0; h < usable.length; h++) {
      const points = usable[h].points;
      let i = pointers[h];
      while (i + 1 < points.length && points[i + 1].time <= t) i++;
      pointers[h] = i;
      const price = points[i].time <= t ? points[i].value : undefined;
      if (typeof price !== "number" || !Number.isFinite(price)) {
        allPriced = false;
        break;
      }
      total += usable[h].holding.quantity * price;
    }
    if (allPriced && Number.isFinite(total)) {
      out.push({ time: t, value: total });
    }
  }
  return out;
}

export function buildPortfolioSeries(
  histories: HoldingHistory[],
): SeriesPoint[] {
  const times = alignedTimes(histories);
  return computePortfolioValues(times, histories);
}
