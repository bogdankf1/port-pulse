export type Ticker = {
  symbol: string;
  name: string;
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
