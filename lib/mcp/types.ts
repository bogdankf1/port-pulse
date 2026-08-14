export type HoldingRow = {
  symbol: string;
  name: string;
  quantity: number | null;
  entry_price: number | null;
};

export type McpHolding = HoldingRow & {
  current_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  weight_pct: number | null;
};

export type McpPortfolioDetail = {
  holdings: McpHolding[];
  totals: {
    market_value: number;
    cost_basis: number | null;
    unrealized_pnl: number | null;
  };
  missing_symbols: string[];
};
