"use client";

type Props = { symbol: string };

type Service = {
  name: string;
  domain: string;
  url: (s: string) => string;
};

const SERVICES: readonly Service[] = [
  {
    name: "Yahoo Finance",
    domain: "finance.yahoo.com",
    url: (s) => `https://finance.yahoo.com/quote/${s}`,
  },
  {
    name: "Zacks",
    domain: "zacks.com",
    url: (s) => `https://www.zacks.com/stock/quote/${s}`,
  },
  {
    name: "TradingView",
    domain: "tradingview.com",
    url: (s) => `https://www.tradingview.com/symbols/${s}/`,
  },
];

export function PositionLinks({ symbol }: Props) {
  const s = encodeURIComponent(symbol);
  return (
    <div className="flex items-center gap-1.5">
      {SERVICES.map((svc) => (
        <a
          key={svc.name}
          href={svc.url(s)}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${symbol} on ${svc.name}`}
          aria-label={`Open ${symbol} on ${svc.name}`}
          className="group inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white/70 transition-colors hover:border-slate-400 hover:bg-white dark:border-slate-800/70 dark:bg-slate-900/60 dark:hover:border-slate-600 dark:hover:bg-slate-900/80"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.google.com/s2/favicons?domain=${svc.domain}&sz=64`}
            alt=""
            className="h-3.5 w-3.5 opacity-80 transition-opacity group-hover:opacity-100"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}
