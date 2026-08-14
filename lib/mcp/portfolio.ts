import type { HoldingRow, McpHolding, McpPortfolioDetail } from "./types";

export function buildPortfolioDetail(
  rows: HoldingRow[],
  prices: Map<string, number>,
): McpPortfolioDetail {
  const missing_symbols: string[] = [];

  const priced = rows.map((row) => {
    const price = prices.get(row.symbol) ?? null;
    if (price === null) missing_symbols.push(row.symbol);

    const market_value =
      price !== null && row.quantity !== null ? price * row.quantity : null;
    const cost =
      row.entry_price !== null && row.quantity !== null
        ? row.entry_price * row.quantity
        : null;
    const unrealized_pnl =
      market_value !== null && cost !== null ? market_value - cost : null;
    const unrealized_pnl_pct =
      unrealized_pnl !== null && cost !== null && cost !== 0
        ? (unrealized_pnl / cost) * 100
        : null;

    return { row, price, market_value, cost, unrealized_pnl, unrealized_pnl_pct };
  });

  const total_market_value = priced.reduce(
    (sum, p) => sum + (p.market_value ?? 0),
    0,
  );

  // Null unless *every* holding has a known entry price: a partial total would
  // read as a real cost basis and make the P&L figure wrong rather than absent.
  const allCostKnown = priced.every((p) => p.cost !== null);
  const cost_basis = allCostKnown
    ? priced.reduce((sum, p) => sum + (p.cost ?? 0), 0)
    : null;
  const unrealized_pnl =
    cost_basis !== null ? total_market_value - cost_basis : null;

  const holdings: McpHolding[] = priced.map((p) => ({
    ...p.row,
    current_price: p.price,
    market_value: p.market_value,
    unrealized_pnl: p.unrealized_pnl,
    unrealized_pnl_pct: p.unrealized_pnl_pct,
    weight_pct:
      p.market_value !== null && total_market_value > 0
        ? (p.market_value / total_market_value) * 100
        : null,
  }));

  return {
    holdings,
    totals: { market_value: total_market_value, cost_basis, unrealized_pnl },
    missing_symbols,
  };
}
