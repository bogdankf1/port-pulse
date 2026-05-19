"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
} from "@/lib/theme";
import { paletteColor, type CompareSeries } from "@/lib/compare";

type Props = { series: CompareSeries[] };

export function CompareSummary({ series }: Props) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    getThemeServerSnapshot,
  );

  const rows = useMemo(() => {
    return series.map((s, idx) => {
      const startPct = s.points[0]?.pct ?? 0;
      const endPct = s.points[s.points.length - 1]?.pct ?? 0;
      const diff = endPct - startPct;
      return {
        id: s.id,
        label: s.label,
        kind: s.kind,
        color: paletteColor(idx, theme),
        startUsd: s.startValue,
        endUsd: s.endValue,
        diff,
      };
    });
  }, [series, theme]);

  if (rows.length === 0) return null;

  return (
    <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white/60 p-4 dark:border-slate-800/70 dark:bg-slate-900/40 sm:p-5">
      <table className="w-full min-w-[480px] border-separate border-spacing-0 text-left font-mono text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-500">
            <th className="pb-2 pr-3 font-medium">Series</th>
            <th className="pb-2 pr-3 text-right font-medium">Start</th>
            <th className="pb-2 pr-3 text-right font-medium">End</th>
            <th className="pb-2 text-right font-medium">% change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-t border-slate-200/70 dark:border-slate-800/70"
            >
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-3 rounded-sm"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="truncate text-slate-800 dark:text-slate-200">
                    {r.label}
                  </span>
                </div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-500 dark:text-slate-500">
                {r.kind === "portfolio" ? formatUsd(r.startUsd) : "0.00%"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-500 dark:text-slate-500">
                {r.kind === "portfolio"
                  ? formatUsd(r.endUsd)
                  : formatPct(r.diff)}
              </td>
              <td
                className={`py-2 text-right tabular-nums ${
                  r.diff >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {formatPct(r.diff)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}
