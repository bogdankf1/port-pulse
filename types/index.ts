export type Ticker = {
  symbol: string;
  name: string;
  quantity?: number;
  entryPrice?: number;
};

export type WatchlistItem = Ticker & {
  id?: string;
  createdAt?: string;
};

export type ParseResult = {
  tickers: Ticker[];
};

export type PriceState = {
  price: number;
  prevPrice: number | null;
  timestamp: number;
};

export type ConnectionState = "idle" | "connecting" | "open" | "closed";

export type CompanyProfile = {
  symbol: string;
  logo: string | null;
  name: string;
};

export type Portfolio = {
  id: string;
  name: string;
  position: number;
  createdAt: string;
};

export type HistoryRange = "1D" | "1M" | "3M" | "YTD" | "1Y" | "5Y";

export type HistoryPoint = {
  time: number;
  value: number;
};

export type HistoryResponse = {
  symbol: string;
  range: HistoryRange;
  interval: string;
  currency: string;
  points: HistoryPoint[];
};

export type PositionPortfolioRow = {
  id: string;
  name: string;
  quantity: number | null;
  entryPrice: number | null;
};

export type PositionDetails = {
  symbol: string;
  name: string;
  totals: {
    quantity: number;
    costBasis: number | null;
  };
  portfolios: PositionPortfolioRow[];
};
