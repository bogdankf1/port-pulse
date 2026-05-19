import type { HistoryRange } from "@/types";
import type { Theme } from "@/lib/theme";

export type CompareKind = "portfolio" | "benchmark";

export type ComparePoint = { time: number; value: number; pct: number };

export type CompareSeries = {
  id: string;
  label: string;
  kind: CompareKind;
  symbol?: string;
  portfolioId?: string;
  points: ComparePoint[];
  startValue: number;
  endValue: number;
};

export type CompareResponse = {
  range: CompareRange;
  startTime: number | null;
  series: CompareSeries[];
  caveat?: string;
};

export const COMPARE_RANGES = ["1M", "3M", "YTD", "1Y", "5Y"] as const;
export type CompareRange = (typeof COMPARE_RANGES)[number];

export const COMPARE_RANGE_LABELS: Record<CompareRange, string> = {
  "1M": "1M",
  "3M": "3M",
  YTD: "YTD",
  "1Y": "1Y",
  "5Y": "5Y",
};

export function isCompareRange(v: unknown): v is CompareRange {
  return (
    typeof v === "string" &&
    (COMPARE_RANGES as readonly string[]).includes(v)
  );
}

// The compare API rejects 1D — narrow to the subset HistoryRanges it accepts.
export function compareRangeToHistory(r: CompareRange): HistoryRange {
  return r;
}

export type Benchmark = { id: string; symbol: string; label: string };

export const BENCHMARKS: readonly Benchmark[] = [
  { id: "SPY", symbol: "SPY", label: "S&P 500 (SPY)" },
  { id: "QQQ", symbol: "QQQ", label: "NASDAQ-100 (QQQ)" },
  { id: "DIA", symbol: "DIA", label: "Dow Jones (DIA)" },
  { id: "IWM", symbol: "IWM", label: "Russell 2000 (IWM)" },
] as const;

export function isBenchmarkId(id: string): boolean {
  return BENCHMARKS.some((b) => b.id === id);
}

const PALETTE_DARK = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#22d3ee",
  "#f43f5e",
  "#84cc16",
];

const PALETTE_LIGHT = [
  "#059669",
  "#2563eb",
  "#d97706",
  "#9333ea",
  "#db2777",
  "#0891b2",
  "#e11d48",
  "#65a30d",
];

export function paletteColor(index: number, theme: Theme): string {
  const palette = theme === "dark" ? PALETTE_DARK : PALETTE_LIGHT;
  return palette[index % palette.length];
}

export async function fetchCompare(params: {
  portfolioIds: string[];
  benchmarkIds: string[];
  range: CompareRange;
  signal?: AbortSignal;
}): Promise<CompareResponse> {
  const qs = new URLSearchParams();
  if (params.portfolioIds.length > 0) {
    qs.set("portfolios", params.portfolioIds.join(","));
  }
  if (params.benchmarkIds.length > 0) {
    qs.set("benchmarks", params.benchmarkIds.join(","));
  }
  qs.set("range", params.range);
  const res = await fetch(`/api/compare?${qs.toString()}`, {
    cache: "no-store",
    signal: params.signal,
  });
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j: { error?: string }) => j?.error)
      .catch(() => undefined);
    throw new Error(msg || `Compare request failed (${res.status})`);
  }
  return (await res.json()) as CompareResponse;
}
