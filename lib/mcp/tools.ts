import "server-only";
import { z } from "zod";
import type { McpAuthContext } from "./auth";
import { createUserClient } from "./supabase";

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
