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
