"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";
import { paletteColor, type CompareSeries } from "@/lib/compare";

type Props = {
  series: CompareSeries[];
  loading: boolean;
  error?: string;
};

type ChartPalette = {
  background: string;
  textColor: string;
  gridColor: string;
  borderColor: string;
  crosshairColor: string;
  zeroLine: string;
};

function chartPaletteFor(theme: Theme): ChartPalette {
  if (theme === "dark") {
    return {
      background: "transparent",
      textColor: "rgba(148, 163, 184, 0.85)",
      gridColor: "rgba(51, 65, 85, 0.35)",
      borderColor: "rgba(51, 65, 85, 0.5)",
      crosshairColor: "rgba(148, 163, 184, 0.5)",
      zeroLine: "rgba(148, 163, 184, 0.45)",
    };
  }
  return {
    background: "transparent",
    textColor: "rgba(71, 85, 105, 0.85)",
    gridColor: "rgba(203, 213, 225, 0.55)",
    borderColor: "rgba(203, 213, 225, 0.7)",
    crosshairColor: "rgba(100, 116, 139, 0.5)",
    zeroLine: "rgba(100, 116, 139, 0.55)",
  };
}

type HoverRow = { id: string; label: string; color: string; pct: number };
type HoverState = { time: number; rows: HoverRow[] };

export function CompareChart({ series, loading, error }: Props) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    getThemeServerSnapshot,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const seriesLookupRef = useRef<
    Map<string, { id: string; label: string; color: string }>
  >(new Map());

  const [hover, setHover] = useState<HoverState | null>(null);

  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    series.forEach((s, idx) => m.set(s.id, paletteColor(idx, theme)));
    return m;
  }, [series, theme]);

  // Create / re-create chart when theme changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const palette = chartPaletteFor(theme);
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
        timeVisible: false,
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
    seriesMapRef.current = new Map();
    seriesLookupRef.current = new Map();

    const onCrosshair = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setHover(null);
        return;
      }
      const t =
        typeof param.time === "number" ? param.time : Number(param.time);
      if (!Number.isFinite(t)) {
        setHover(null);
        return;
      }
      const rows: HoverRow[] = [];
      seriesMapRef.current.forEach((api, id) => {
        const meta = seriesLookupRef.current.get(id);
        if (!meta) return;
        const data = param.seriesData.get(api) as
          | { value?: number }
          | undefined;
        const v = data?.value;
        if (typeof v !== "number" || !Number.isFinite(v)) return;
        rows.push({ id, label: meta.label, color: meta.color, pct: v });
      });
      if (rows.length === 0) {
        setHover(null);
        return;
      }
      setHover({ time: t, rows });
    };
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
      chartRef.current = null;
      seriesMapRef.current = new Map();
      seriesLookupRef.current = new Map();
    };
  }, [theme]);

  // Reconcile series into the chart whenever data, colors, or theme change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentIds = new Set(series.map((s) => s.id));
    // Remove series that no longer exist.
    for (const [id, api] of Array.from(seriesMapRef.current.entries())) {
      if (!currentIds.has(id)) {
        chart.removeSeries(api);
        seriesMapRef.current.delete(id);
        seriesLookupRef.current.delete(id);
      }
    }

    for (const s of series) {
      const color = colorById.get(s.id) || "#10b981";
      let api = seriesMapRef.current.get(s.id);
      if (!api) {
        api = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerRadius: 3,
        });
        seriesMapRef.current.set(s.id, api);
      } else {
        api.applyOptions({ color });
      }
      seriesLookupRef.current.set(s.id, {
        id: s.id,
        label: s.label,
        color,
      });
      const data = s.points.map((p) => ({
        time: p.time as UTCTimestamp,
        value: p.pct,
      }));
      api.setData(data);
    }

    if (series.length > 0) {
      chart.timeScale().fitContent();
    }
  }, [series, colorById]);

  const hasData = series.length > 0 && series.some((s) => s.points.length > 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white/60 p-4 dark:border-slate-800/70 dark:bg-slate-900/40 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-500">
          % change from start
        </div>
        {hover && (
          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-500">
            {formatChartDate(hover.time)}
          </div>
        )}
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[300px] w-full sm:h-[420px]"
          aria-label="Portfolio comparison chart"
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
              {error}
            </span>
          </div>
        )}
        {!loading && !error && !hasData && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              Pick at least one portfolio or benchmark to compare.
            </span>
          </div>
        )}
        {!loading && !error && hover && hover.rows.length > 0 && (
          <div className="pointer-events-none absolute right-2 top-2 max-w-[260px] rounded-md border border-slate-200/80 bg-white/95 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-slate-700 shadow-md backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/90 dark:text-slate-200">
            <ul className="flex flex-col gap-0.5">
              {hover.rows.map((row) => (
                <li key={row.id} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-3 rounded-sm"
                    style={{ backgroundColor: row.color }}
                  />
                  <span className="flex-1 truncate text-slate-600 dark:text-slate-400">
                    {row.label}
                  </span>
                  <span
                    className={
                      row.pct >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {formatPct(row.pct)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function formatPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function formatChartDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
