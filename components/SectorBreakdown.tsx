"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Ticker, SectorSlice } from "@/types";
import { getPriceSync, usePortfolioVersion } from "@/lib/finnhub";
import { getSectorSync, useSectorsVersion } from "@/lib/sectors";
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";

type Props = {
  tickers: Ticker[];
};

const UNCLASSIFIED = "Other";
const MIN_PERCENT_FOR_OWN_SLICE = 0.02;

const SECTOR_PALETTE_DARK: Record<string, string> = {
  Technology: "#60a5fa",
  "Financial Services": "#34d399",
  Healthcare: "#f472b6",
  "Consumer Cyclical": "#fb923c",
  "Consumer Defensive": "#fbbf24",
  "Communication Services": "#a78bfa",
  Industrials: "#22d3ee",
  Energy: "#f87171",
  "Basic Materials": "#facc15",
  Utilities: "#4ade80",
  "Real Estate": "#fb7185",
  Other: "#94a3b8",
};

const SECTOR_PALETTE_LIGHT: Record<string, string> = {
  Technology: "#2563eb",
  "Financial Services": "#059669",
  Healthcare: "#db2777",
  "Consumer Cyclical": "#ea580c",
  "Consumer Defensive": "#d97706",
  "Communication Services": "#7c3aed",
  Industrials: "#0891b2",
  Energy: "#dc2626",
  "Basic Materials": "#ca8a04",
  Utilities: "#16a34a",
  "Real Estate": "#e11d48",
  Other: "#64748b",
};

function colorFor(sector: string, theme: Theme): string {
  const palette = theme === "dark" ? SECTOR_PALETTE_DARK : SECTOR_PALETTE_LIGHT;
  return palette[sector] ?? palette.Other;
}

function computeSlices(tickers: Ticker[]): SectorSlice[] {
  const buckets = new Map<string, { value: number; symbols: string[] }>();
  let total = 0;

  for (const t of tickers) {
    const price = getPriceSync(t.symbol);
    if (price == null || t.quantity == null) continue;
    const value = price * t.quantity;
    if (value <= 0) continue;
    const sector = getSectorSync(t.symbol) ?? UNCLASSIFIED;
    total += value;
    const existing = buckets.get(sector);
    if (existing) {
      existing.value += value;
      existing.symbols.push(t.symbol);
    } else {
      buckets.set(sector, { value, symbols: [t.symbol] });
    }
  }

  if (total <= 0) return [];

  const slices: SectorSlice[] = [];
  let otherValue = 0;
  let otherSymbols: string[] = [];

  const entries = Array.from(buckets.entries()).sort(
    (a, b) => b[1].value - a[1].value,
  );

  for (const [sector, { value, symbols }] of entries) {
    const percent = value / total;
    if (sector === UNCLASSIFIED || percent < MIN_PERCENT_FOR_OWN_SLICE) {
      otherValue += value;
      otherSymbols = otherSymbols.concat(symbols);
      continue;
    }
    slices.push({ sector, value, percent, symbols });
  }

  if (otherValue > 0) {
    slices.push({
      sector: UNCLASSIFIED,
      value: otherValue,
      percent: otherValue / total,
      symbols: otherSymbols,
    });
  }

  return slices;
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function SectorBreakdown({ tickers }: Props) {
  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  const priceVersion = usePortfolioVersion(symbols);
  const sectorsVersion = useSectorsVersion(symbols);
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    getThemeServerSnapshot,
  );

  const slices = useMemo(
    () => computeSlices(tickers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickers, priceVersion, sectorsVersion],
  );

  const total = useMemo(
    () => slices.reduce((acc, s) => acc + s.value, 0),
    [slices],
  );

  if (slices.length === 0) return null;

  const tooltipBg = theme === "dark" ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = theme === "dark" ? "rgba(51, 65, 85, 0.7)" : "rgba(203, 213, 225, 0.8)";
  const tooltipText = theme === "dark" ? "#e2e8f0" : "#0f172a";

  return (
    <section className="mb-4 border-b border-slate-200 px-4 pb-5 dark:border-slate-800/70 sm:mb-5 sm:rounded-xl sm:border sm:bg-white/60 sm:p-5 sm:dark:bg-slate-900/40">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
          Sector allocation
        </h2>
        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
          ${formatMoney(total)} · {slices.length}{" "}
          {slices.length === 1 ? "sector" : "sectors"}
        </div>
      </div>
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[200px_1fr] sm:gap-6">
        <div className="relative h-[180px] w-full sm:h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="sector"
                innerRadius="60%"
                outerRadius="92%"
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.sector} fill={colorFor(s.sector, theme)} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: tooltipBg,
                  border: `1px solid ${tooltipBorder}`,
                  borderRadius: 6,
                  color: tooltipText,
                  fontSize: 12,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  padding: "6px 10px",
                }}
                formatter={(value, _name, item) => {
                  const num = typeof value === "number" ? value : 0;
                  const slice = item?.payload as SectorSlice | undefined;
                  const pct = slice ? formatPercent(slice.percent) : "";
                  return [`$${formatMoney(num)}  (${pct})`, slice?.sector ?? ""];
                }}
                labelFormatter={() => ""}
                separator=" "
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Total
              </div>
              <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                ${formatMoney(total)}
              </div>
            </div>
          </div>
        </div>
        <ul className="flex flex-col gap-1.5">
          {slices.map((s) => (
            <li
              key={s.sector}
              className="flex items-center gap-2.5 font-mono text-xs"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: colorFor(s.sector, theme) }}
              />
              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                {s.sector}
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                ${formatMoney(s.value)}
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums text-slate-900 dark:text-slate-100">
                {formatPercent(s.percent)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
