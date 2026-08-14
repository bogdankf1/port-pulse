import "server-only";
import { z } from "zod";
import type { McpAuthContext } from "./auth";
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
