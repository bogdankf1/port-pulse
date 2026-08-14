import "server-only";
import { fetchYahooChart } from "@/lib/yahoo";

/**
 * Latest close per symbol. Symbols that fail are simply absent from the map;
 * callers surface them as missing rather than substituting a zero, which would
 * silently corrupt weights and totals.
 *
 * `Promise.allSettled` rather than `Promise.all` is deliberate: one delisted or
 * rate-limited symbol must not fail the whole portfolio.
 */
export async function fetchCurrentPrices(
  symbols: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(symbols)];

  const settled = await Promise.allSettled(
    unique.map(async (symbol) => {
      const chart = await fetchYahooChart(symbol, "1D");
      const last = chart.points.at(-1);
      if (!last || !Number.isFinite(last.value) || last.value <= 0) {
        throw new Error(`No usable price for ${symbol}`);
      }
      return [symbol, last.value] as const;
    }),
  );

  const prices = new Map<string, number>();
  for (const result of settled) {
    if (result.status === "fulfilled") {
      prices.set(result.value[0], result.value[1]);
    }
  }
  return prices;
}
