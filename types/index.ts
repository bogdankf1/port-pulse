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

export type SectorSlice = {
  sector: string;
  value: number;
  percent: number;
  symbols: string[];
};

export type PortfolioHistoryRange = "1D" | "1M" | "3M" | "YTD" | "1Y";

export type PortfolioHistoryResponse = {
  range: PortfolioHistoryRange;
  points: HistoryPoint[];
  startValue: number | null;
  endValue: number | null;
  missing_symbols: string[];
  caveat: string;
};

export type AssistantRole = "user" | "assistant";

export type AssistantMessage = {
  id: string;
  role: AssistantRole;
  content: string;
  createdAt: string;
};

export type AssistantConversation = {
  id: string;
  title: string | null;
  updatedAt: string;
};

/** A cash or bank account balance, stored in its native currency. */
export type Balance = {
  id: string;
  label: string;
  amount: number;
  currency: string;
  /** ISO timestamp of when the figure was true, not when the row was written. */
  asOf: string;
};

/** One row as read out of an uploaded CSV, before it is saved. */
export type ParsedBalance = {
  label: string;
  amount: number;
  currency: string;
};
