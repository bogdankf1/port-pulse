import type { HistoryRange, HistoryResponse } from "@/types";

export const HISTORY_RANGES: readonly HistoryRange[] = [
  "1D",
  "1M",
  "3M",
  "YTD",
  "1Y",
  "5Y",
] as const;

export const HISTORY_RANGE_LABELS: Record<HistoryRange, string> = {
  "1D": "1D",
  "1M": "1M",
  "3M": "3M",
  YTD: "YTD",
  "1Y": "1Y",
  "5Y": "5Y",
};

export async function fetchHistory(
  symbol: string,
  range: HistoryRange,
  signal?: AbortSignal,
): Promise<HistoryResponse> {
  const url = `/api/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`;
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j: { error?: string }) => j?.error)
      .catch(() => undefined);
    throw new Error(msg || `History request failed (${res.status})`);
  }
  return (await res.json()) as HistoryResponse;
}
