"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchHistory, HISTORY_RANGES, HISTORY_RANGE_LABELS } from "@/lib/history";
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";
import type { HistoryPoint, HistoryRange } from "@/types";

type Props = { symbol: string };

type ChartPalette = {
  background: string;
  textColor: string;
  gridColor: string;
  borderColor: string;
  crosshairColor: string;
  posLine: string;
  posTop: string;
  posBottom: string;
  negLine: string;
  negTop: string;
  negBottom: string;
};

function paletteFor(theme: Theme): ChartPalette {
  if (theme === "dark") {
    return {
      background: "transparent",
      textColor: "rgba(148, 163, 184, 0.85)",
      gridColor: "rgba(51, 65, 85, 0.35)",
      borderColor: "rgba(51, 65, 85, 0.5)",
      crosshairColor: "rgba(148, 163, 184, 0.5)",
      posLine: "#10b981",
      posTop: "rgba(16, 185, 129, 0.35)",
      posBottom: "rgba(16, 185, 129, 0)",
      negLine: "#ef4444",
      negTop: "rgba(239, 68, 68, 0.35)",
      negBottom: "rgba(239, 68, 68, 0)",
    };
  }
  return {
    background: "transparent",
    textColor: "rgba(71, 85, 105, 0.85)",
    gridColor: "rgba(203, 213, 225, 0.55)",
    borderColor: "rgba(203, 213, 225, 0.7)",
    crosshairColor: "rgba(100, 116, 139, 0.5)",
    posLine: "#059669",
    posTop: "rgba(16, 185, 129, 0.28)",
    posBottom: "rgba(16, 185, 129, 0)",
    negLine: "#dc2626",
    negTop: "rgba(239, 68, 68, 0.28)",
    negBottom: "rgba(239, 68, 68, 0)",
  };
}

type Hover = {
  key: string;
  time: number;
  value: number;
};

type FetchSlot = {
  key: string;
  points: HistoryPoint[];
  error?: string;
};

export function PositionChart({ symbol }: Props) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    getThemeServerSnapshot,
  );

  const [range, setRange] = useState<HistoryRange>("1M");
  const [slot, setSlot] = useState<FetchSlot | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const requestedKey = `${symbol}|${range}`;
  const slotMatches = slot?.key === requestedKey;
  const points = useMemo<HistoryPoint[]>(
    () => (slotMatches ? slot.points : []),
    [slotMatches, slot],
  );
  const error = slotMatches ? slot.error : undefined;
  const loading = !slotMatches;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const seriesKindRef = useRef<"area" | "line" | null>(null);
  const keyRef = useRef<string>(requestedKey);
  useEffect(() => {
    keyRef.current = requestedKey;
  }, [requestedKey]);

  // Fetch when symbol or range changes. State only updates inside async
  // callbacks so we never call setState synchronously in the effect body.
  useEffect(() => {
    const controller = new AbortController();
    const key = `${symbol}|${range}`;
    fetchHistory(symbol, range, controller.signal)
      .then((res) => {
        setSlot({ key, points: res.points });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setSlot({
          key,
          points: [],
          error: err.message || "Failed to load history",
        });
      });
    return () => controller.abort();
  }, [symbol, range]);

  const netChange = useMemo(() => {
    if (points.length < 2) return 0;
    const first = points[0].value;
    const last = points[points.length - 1].value;
    return last - first;
  }, [points]);

  const isUp = netChange >= 0;
  const visibleHover = hover?.key === requestedKey ? hover : null;

  // Create / re-create chart instance when theme changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const palette = paletteFor(theme);
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: palette.background },
        textColor: palette.textColor,
        fontFamily:
          "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: palette.gridColor },
        horzLines: { color: palette.gridColor },
      },
      rightPriceScale: { borderColor: palette.borderColor },
      timeScale: {
        borderColor: palette.borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: palette.crosshairColor, width: 1, style: 3 },
        horzLine: { color: palette.crosshairColor, width: 1, style: 3 },
      },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;
    seriesRef.current = null;
    seriesKindRef.current = null;

    const onCrosshair = (param: MouseEventParams) => {
      const series = seriesRef.current;
      const k = keyRef.current;
      if (!series || !param.time || !param.point || !k) {
        setHover(null);
        return;
      }
      const value = param.seriesData.get(series) as
        | { value?: number; close?: number }
        | undefined;
      const v = value?.value ?? value?.close;
      if (typeof v !== "number") {
        setHover(null);
        return;
      }
      const tNum =
        typeof param.time === "number" ? param.time : Number(param.time);
      if (!Number.isFinite(tNum)) {
        setHover(null);
        return;
      }
      setHover({ key: k, time: tNum, value: v });
    };
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      seriesKindRef.current = null;
    };
  }, [theme]);

  // Update series data when points / theme / direction changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (points.length === 0) {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
        seriesKindRef.current = null;
      }
      return;
    }
    const palette = paletteFor(theme);
    const wantKind: "area" | "line" = range === "1D" ? "line" : "area";

    if (seriesRef.current && seriesKindRef.current !== wantKind) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
      seriesKindRef.current = null;
    }

    if (!seriesRef.current) {
      if (wantKind === "area") {
        seriesRef.current = chart.addSeries(AreaSeries, {
          lineColor: isUp ? palette.posLine : palette.negLine,
          topColor: isUp ? palette.posTop : palette.negTop,
          bottomColor: isUp ? palette.posBottom : palette.negBottom,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerRadius: 4,
        });
      } else {
        seriesRef.current = chart.addSeries(LineSeries, {
          color: isUp ? palette.posLine : palette.negLine,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerRadius: 4,
        });
      }
      seriesKindRef.current = wantKind;
    } else {
      seriesRef.current.applyOptions(
        wantKind === "area"
          ? {
              lineColor: isUp ? palette.posLine : palette.negLine,
              topColor: isUp ? palette.posTop : palette.negTop,
              bottomColor: isUp ? palette.posBottom : palette.negBottom,
            }
          : { color: isUp ? palette.posLine : palette.negLine },
      );
    }

    const data = points.map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value,
    }));
    seriesRef.current.setData(data);
    chart.timeScale().fitContent();
  }, [points, theme, isUp, range]);

  return (
    <section className="px-4 pb-5 sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white/60 sm:p-5 sm:dark:border-slate-800/70 sm:dark:bg-slate-900/40">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-500">
            Price history
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            {points.length >= 2 && (
              <span
                className={`font-mono text-sm tabular-nums ${
                  isUp
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {isUp ? "+" : "−"}${Math.abs(netChange).toFixed(2)} (
                {((netChange / points[0].value) * 100).toFixed(2)}%)
              </span>
            )}
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-500">
              {HISTORY_RANGE_LABELS[range]}
            </span>
          </div>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[280px] w-full sm:h-[360px]"
          aria-label={`Price chart for ${symbol}`}
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-600">
              Loading…
            </span>
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              Could not load chart — {error}
            </span>
          </div>
        )}
        {!loading && !error && visibleHover && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-slate-200/80 bg-white/90 px-2 py-1 font-mono text-[11px] tabular-nums text-slate-700 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/85 dark:text-slate-200">
            <div className="text-slate-500 dark:text-slate-500">
              {formatHoverDate(visibleHover.time, range)}
            </div>
            <div className="text-sm font-semibold">
              ${visibleHover.value.toFixed(2)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function RangeToggle({
  range,
  onChange,
}: {
  range: HistoryRange;
  onChange: (r: HistoryRange) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Chart timeframe"
      className="inline-flex rounded-md border border-slate-200 bg-white/70 p-0.5 text-[11px] font-medium dark:border-slate-800 dark:bg-slate-900/60"
    >
      {HISTORY_RANGES.map((r) => {
        const active = r === range;
        return (
          <button
            key={r}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(r)}
            className={`rounded px-2.5 py-1 font-mono tracking-wide transition-colors ${
              active
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {HISTORY_RANGE_LABELS[r]}
          </button>
        );
      })}
    </div>
  );
}

function formatHoverDate(unixSeconds: number, range: HistoryRange): string {
  const d = new Date(unixSeconds * 1000);
  if (range === "1D") {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
