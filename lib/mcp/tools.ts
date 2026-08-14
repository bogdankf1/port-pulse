import "server-only";
import { z } from "zod";
// Only HISTORY_RANGES and the HistoryRange type come from @/lib/history — not
// fetchHistory, which is client-side and issues a relative fetch that cannot
// resolve on the server.
import { HISTORY_RANGES } from "@/lib/history";
import { fetchYahooChart, YahooFetchError } from "@/lib/yahoo";
// lib/sectors.ts exports React hooks and must not be imported here; the map in
// lib/sectorMap.ts is the synchronous lookup the sectors route also uses.
import { lookupSector } from "@/lib/sectorMap";
import type { HistoryRange } from "@/types";
import type { McpAuthContext } from "./auth";
import { MAX_SYMBOLS, SYMBOL_RE } from "./config";
import { computePortfolioRisk } from "./risk";
import { createUserClient } from "./supabase";
import { buildPortfolioDetail } from "./portfolio";
import { fetchCurrentPrices } from "./quotes";
import type { HoldingRow, McpPortfolioDetail } from "./types";

export const NO_PORTFOLIOS_MESSAGE =
  "This account has no portfolios yet. Upload a portfolio screenshot at " +
  "https://port-pulse-seven.vercel.app to create one.";

export type PortfolioSummary = {
  id: string;
  name: string;
  holdings_count: number;
};

export const listPortfoliosSchema = z.object({});

export async function listPortfolios(
  ctx: McpAuthContext,
): Promise<PortfolioSummary[] | { message: string }> {
  const supabase = createUserClient(ctx);

  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name, watchlist_items(count)")
    .eq("user_id", ctx.userId)
    .order("position", { ascending: true });

  if (error) throw new Error(`Failed to load portfolios: ${error.message}`);
  if (!data || data.length === 0) return { message: NO_PORTFOLIOS_MESSAGE };

  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    holdings_count:
      (row.watchlist_items as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

export const getPortfolioSchema = z.object({
  portfolio_id: z.string().uuid().optional(),
  name: z.string().min(1).max(80).optional(),
});

/** `portfolio_id` wins when both are supplied. */
export async function getPortfolio(
  ctx: McpAuthContext,
  args: { portfolio_id?: string; name?: string },
): Promise<(McpPortfolioDetail & { id: string; name: string }) | { message: string }> {
  const supabase = createUserClient(ctx);

  const { data: portfolios, error: pErr } = await supabase
    .from("portfolios")
    .select("id, name")
    .eq("user_id", ctx.userId);

  if (pErr) throw new Error(`Failed to load portfolios: ${pErr.message}`);
  if (!portfolios || portfolios.length === 0) {
    return { message: NO_PORTFOLIOS_MESSAGE };
  }

  let match: { id: string; name: string } | undefined;
  if (args.portfolio_id) {
    match = portfolios.find((p) => p.id === args.portfolio_id);
  } else if (args.name) {
    const wanted = args.name.trim().toLowerCase();
    const hits = portfolios.filter((p) => p.name.toLowerCase() === wanted);
    if (hits.length > 1) {
      throw new Error(
        `More than one portfolio is named "${args.name}". Use portfolio_id instead. ` +
          `Ids: ${hits.map((h) => h.id).join(", ")}`,
      );
    }
    match = hits[0];
  } else {
    throw new Error("Provide either portfolio_id or name.");
  }

  if (!match) {
    throw new Error(
      `No such portfolio. Available: ${portfolios.map((p) => p.name).join(", ")}`,
    );
  }

  const { data: items, error: iErr } = await supabase
    .from("watchlist_items")
    .select("symbol, name, quantity, entry_price")
    .eq("portfolio_id", match.id)
    .eq("user_id", ctx.userId);

  if (iErr) throw new Error(`Failed to load holdings: ${iErr.message}`);

  const rows: HoldingRow[] = (items ?? []).map((i) => ({
    symbol: i.symbol as string,
    name: (i.name as string) ?? "",
    quantity: (i.quantity as number | null) ?? null,
    entry_price: (i.entry_price as number | null) ?? null,
  }));

  // A total upstream failure is an error rather than a zero-priced portfolio,
  // which would read as real data.
  const prices = await fetchCurrentPrices(rows.map((r) => r.symbol));
  if (rows.length > 0 && prices.size === 0) {
    throw new Error(
      "Price data is unavailable upstream right now. Try again shortly.",
    );
  }

  return { id: match.id, name: match.name, ...buildPortfolioDetail(rows, prices) };
}

export const getPositionSchema = z.object({
  symbol: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => SYMBOL_RE.test(s), "Not a valid ticker symbol"),
});

/** Total exposure to one ticker, aggregated across every portfolio. */
export async function getPosition(ctx: McpAuthContext, args: { symbol: string }) {
  const supabase = createUserClient(ctx);

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("quantity, entry_price, portfolios(id, name)")
    .eq("user_id", ctx.userId)
    .eq("symbol", args.symbol);

  if (error) throw new Error(`Failed to load position: ${error.message}`);
  if (!data || data.length === 0) {
    return { message: `${args.symbol} is not held in any portfolio.` };
  }

  const prices = await fetchCurrentPrices([args.symbol]);
  const current_price = prices.get(args.symbol) ?? null;

  const portfolios = data.map((row) => {
    const p = row.portfolios as unknown as { id: string; name: string } | null;
    return {
      portfolio_id: p?.id ?? null,
      portfolio_name: p?.name ?? null,
      quantity: (row.quantity as number | null) ?? null,
      entry_price: (row.entry_price as number | null) ?? null,
    };
  });

  const total_quantity = portfolios.reduce((s, p) => s + (p.quantity ?? 0), 0);
  const allCostKnown = portfolios.every(
    (p) => p.quantity !== null && p.entry_price !== null,
  );
  const cost_basis = allCostKnown
    ? portfolios.reduce((s, p) => s + p.quantity! * p.entry_price!, 0)
    : null;

  return {
    symbol: args.symbol,
    current_price,
    total_quantity,
    cost_basis,
    market_value: current_price !== null ? current_price * total_quantity : null,
    portfolios,
  };
}

export const getPriceHistorySchema = z.object({
  symbol: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => SYMBOL_RE.test(s), "Not a valid ticker symbol"),
  range: z.enum(HISTORY_RANGES as unknown as [HistoryRange, ...HistoryRange[]]),
});

export async function getPriceHistory(
  _ctx: McpAuthContext,
  args: { symbol: string; range: HistoryRange },
) {
  try {
    return await fetchYahooChart(args.symbol, args.range);
  } catch (err) {
    if (err instanceof YahooFetchError) {
      throw new Error(`Price history unavailable: ${err.message}`);
    }
    throw err;
  }
}

export const getRiskMetricsSchema = z.object({
  portfolio_id: z.string().uuid(),
});

export async function getRiskMetrics(
  ctx: McpAuthContext,
  args: { portfolio_id: string },
) {
  const supabase = createUserClient(ctx);

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("symbol, quantity")
    .eq("portfolio_id", args.portfolio_id)
    .eq("user_id", ctx.userId);

  if (error) throw new Error(`Failed to load holdings: ${error.message}`);

  const holdings = (data ?? [])
    .map((r) => ({
      symbol: r.symbol as string,
      quantity: (r.quantity as number | null) ?? 0,
    }))
    .filter((h) => h.quantity > 0)
    .slice(0, MAX_SYMBOLS);

  if (holdings.length === 0) {
    return {
      message:
        "Risk metrics need holdings with a quantity. This portfolio has none recorded.",
    };
  }

  return computePortfolioRisk(holdings);
}

export const getSectorBreakdownSchema = z.object({
  portfolio_id: z.string().uuid(),
});

export async function getSectorBreakdown(
  ctx: McpAuthContext,
  args: { portfolio_id: string },
) {
  const supabase = createUserClient(ctx);

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("symbol, quantity")
    .eq("portfolio_id", args.portfolio_id)
    .eq("user_id", ctx.userId);

  if (error) throw new Error(`Failed to load holdings: ${error.message}`);

  const rows = (data ?? [])
    .map((r) => ({
      symbol: r.symbol as string,
      quantity: (r.quantity as number | null) ?? 0,
    }))
    .filter((h) => h.quantity > 0);

  if (rows.length === 0) {
    return {
      message:
        "A sector breakdown needs holdings with a quantity. This portfolio has none recorded.",
    };
  }

  const prices = await fetchCurrentPrices(rows.map((r) => r.symbol));

  const byName = new Map<string, { value: number; symbols: string[] }>();
  let total = 0;
  const missing_symbols: string[] = [];

  for (const row of rows) {
    const price = prices.get(row.symbol);
    if (price === undefined) {
      missing_symbols.push(row.symbol);
      continue;
    }
    const value = price * row.quantity;
    total += value;

    const sector = lookupSector(row.symbol) ?? "Unknown";
    const entry = byName.get(sector) ?? { value: 0, symbols: [] };
    entry.value += value;
    entry.symbols.push(row.symbol);
    byName.set(sector, entry);
  }

  const sectors = [...byName.entries()]
    .map(([sector, e]) => ({
      sector,
      value: e.value,
      percent: total > 0 ? (e.value / total) * 100 : 0,
      symbols: e.symbols,
    }))
    .sort((a, b) => b.value - a.value);

  return { sectors, total_value: total, missing_symbols };
}
