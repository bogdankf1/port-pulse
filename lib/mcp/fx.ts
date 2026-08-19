import "server-only";
import { z } from "zod";
import { fetchYahooChart, YahooFetchError } from "@/lib/yahoo";

/**
 * Currency conversion on top of the Yahoo chart endpoint the rest of the app
 * already uses — Yahoo quotes FX pairs as `USDUAH=X`, so this needs no second
 * provider, no second API key, and inherits the existing caching and error
 * handling. Verified live for USD/EUR/UAH in both directions.
 */

const CODE_RE = /^[A-Z]{3}$/;

/** Named in the tool description so the model leads with the ones we've checked. */
export const PRIMARY_CURRENCIES = ["USD", "EUR", "UAH"] as const;

export const convertCurrencySchema = z.object({
  amount: z
    .number()
    .finite()
    .describe("Amount to convert, in the `from` currency."),
  from: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => CODE_RE.test(s), "Not a 3-letter currency code"),
  to: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => CODE_RE.test(s), "Not a 3-letter currency code"),
});

export type ConvertCurrencyResult = {
  amount: number;
  from: string;
  to: string;
  rate: number;
  converted: number;
  as_of: string;
  source: "Yahoo Finance";
};

export async function convertCurrency(args: {
  amount: number;
  from: string;
  to: string;
}): Promise<ConvertCurrencyResult> {
  const { amount, from, to } = args;

  if (from === to) {
    return {
      amount,
      from,
      to,
      rate: 1,
      converted: amount,
      as_of: new Date().toISOString(),
      source: "Yahoo Finance",
    };
  }

  // `1D` at a 5-minute interval is the freshest series this client exposes;
  // its last point is the current rate.
  let chart;
  try {
    chart = await fetchYahooChart(`${from}${to}=X`, "1D");
  } catch (err) {
    if (err instanceof YahooFetchError) {
      throw new Error(
        `No exchange rate available for ${from}/${to} — ${err.message}`,
      );
    }
    throw err;
  }

  const last = chart.points.at(-1);
  if (!last || !Number.isFinite(last.value) || last.value <= 0) {
    throw new Error(`No usable exchange rate for ${from}/${to}`);
  }

  return {
    amount,
    from,
    to,
    rate: last.value,
    converted: amount * last.value,
    as_of: new Date(last.time * 1000).toISOString(),
    source: "Yahoo Finance",
  };
}

/**
 * Rate to USD for each currency, keyed by the currency code.
 *
 * `allSettled` rather than `all`: one unquotable currency must leave the other
 * balances convertible, and callers report the gap instead of counting the
 * unconverted amount as zero.
 */
export async function usdRates(
  currencies: readonly string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(currencies.map((c) => c.trim().toUpperCase()))].filter(
    (c) => CODE_RE.test(c) && c !== "USD",
  );

  const settled = await Promise.allSettled(
    unique.map(async (code) => {
      const chart = await fetchYahooChart(`${code}USD=X`, "1D");
      const last = chart.points.at(-1);
      if (!last || !Number.isFinite(last.value) || last.value <= 0) {
        throw new Error(`No rate for ${code}`);
      }
      return [code, last.value] as const;
    }),
  );

  const rates = new Map<string, number>([["USD", 1]]);
  for (const result of settled) {
    if (result.status === "fulfilled") rates.set(result.value[0], result.value[1]);
  }
  return rates;
}
