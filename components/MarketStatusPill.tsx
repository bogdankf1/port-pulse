"use client";

import { useEffect, useState } from "react";
import {
  formatOpenCountdown,
  getMarketStatus,
  type MarketStatus,
} from "@/lib/marketHours";

export function MarketStatusPill() {
  const [status, setStatus] = useState<MarketStatus | null>(null);

  useEffect(() => {
    const tick = () => setStatus(getMarketStatus());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!status) return null;

  const isOpen = status.open;
  const dotColor = isOpen
    ? "bg-emerald-500"
    : "bg-slate-400 dark:bg-slate-500";
  const labelMobile = isOpen ? "Open" : "Closed";
  const labelDesktop = formatOpenCountdown(status);

  return (
    <div
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-2.5 text-[11px] font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 sm:px-3"
      title={isOpen ? "US market is open · " + labelDesktop : labelDesktop}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        {isOpen && (
          <span className="absolute inset-0 inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 dark:bg-emerald-400" />
        )}
        <span
          className={`relative inline-block h-1.5 w-1.5 rounded-full ${dotColor}`}
          aria-hidden
        />
      </span>
      <span className="hidden sm:inline">{labelDesktop}</span>
      <span className="sm:hidden">{labelMobile}</span>
    </div>
  );
}
