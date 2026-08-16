"use client";

import { PortfolioHeatmap } from "../../PortfolioHeatmap";
import type { Ticker } from "@/types";

type Props = { tickers: Ticker[] };

export function HeatmapTab({ tickers }: Props) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Today · size = value
        </h3>
      </div>
      <div className="-mx-1">
        <PortfolioHeatmap tickers={tickers} maxTiles={8} />
      </div>
      <p className="mt-2 font-mono text-[10px] text-slate-400 dark:text-slate-600">
        Tap a tile to open that position.
      </p>
    </div>
  );
}
