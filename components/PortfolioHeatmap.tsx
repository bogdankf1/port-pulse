"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { Ticker } from "@/types";
import { getPriceSync, usePortfolioVersion } from "@/lib/finnhub";
import {
  getDailyCloseSync,
  useDailyCloseVersion,
} from "@/lib/dailyClose";
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";

type Props = {
  tickers: Ticker[];
};

type HeatTile = {
  symbol: string;
  name: string;
  size: number; // market value used by Treemap for layout
  percent: number;
  price: number;
  dailyPct: number | null;
};

const POS_COLORS_DARK = [
  "#064e3b", // -3%+ baseline
  "#065f46",
  "#047857",
  "#059669",
  "#10b981",
  "#34d399",
];
const NEG_COLORS_DARK = [
  "#7f1d1d",
  "#991b1b",
  "#b91c1c",
  "#dc2626",
  "#ef4444",
  "#f87171",
];

const POS_COLORS_LIGHT = [
  "#86efac",
  "#4ade80",
  "#22c55e",
  "#16a34a",
  "#15803d",
  "#166534",
];
const NEG_COLORS_LIGHT = [
  "#fecaca",
  "#fca5a5",
  "#f87171",
  "#ef4444",
  "#dc2626",
  "#b91c1c",
];

function colorForPct(pct: number | null, theme: Theme): string {
  if (pct == null) return theme === "dark" ? "#1e293b" : "#e2e8f0";
  const pos = theme === "dark" ? POS_COLORS_DARK : POS_COLORS_LIGHT;
  const neg = theme === "dark" ? NEG_COLORS_DARK : NEG_COLORS_LIGHT;
  if (pct === 0) return theme === "dark" ? "#1f2937" : "#e2e8f0";
  const abs = Math.min(Math.abs(pct), 3) / 3; // 0..1 over 0..3%
  const idx = Math.min(5, Math.floor(abs * 6));
  return pct > 0 ? pos[idx] : neg[idx];
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function buildTiles(tickers: Ticker[]): HeatTile[] {
  const tiles: HeatTile[] = [];
  let total = 0;

  for (const t of tickers) {
    const price = getPriceSync(t.symbol);
    if (price == null || t.quantity == null) continue;
    const value = price * t.quantity;
    if (value <= 0) continue;
    total += value;
    const prevClose = getDailyCloseSync(t.symbol);
    const dailyPct =
      prevClose != null && prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : null;
    tiles.push({
      symbol: t.symbol,
      name: t.name,
      size: value,
      percent: 0,
      price,
      dailyPct,
    });
  }

  if (total <= 0) return [];

  for (const tile of tiles) {
    tile.percent = tile.size / total;
  }

  tiles.sort((a, b) => b.size - a.size);
  return tiles;
}

type TreemapContentProps = {
  depth?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  symbol?: string;
  percent?: number;
  dailyPct?: number | null;
};

function renderTile(
  props: TreemapContentProps,
  theme: Theme,
  onSelect: (symbol: string) => void,
) {
  const {
    depth = 0,
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    symbol,
    dailyPct,
  } = props;

  // Treemap calls content for the root (depth=0) and leaves (depth=1).
  // Only render leaves.
  if (depth === 0 || !symbol || width <= 1 || height <= 1) {
    return <g />;
  }

  const bg = colorForPct(dailyPct ?? null, theme);
  const textColor = theme === "dark" ? "#e2e8f0" : "#f8fafc";
  const dimText =
    theme === "dark" ? "rgba(226,232,240,0.75)" : "rgba(248,250,252,0.85)";
  const showLabel = width > 56 && height > 36;
  const showPct = width > 64 && height > 52;
  const dailyLabel =
    dailyPct == null
      ? "—"
      : `${dailyPct >= 0 ? "+" : ""}${dailyPct.toFixed(2)}%`;

  return (
    <g style={{ cursor: "pointer" }} onClick={() => onSelect(symbol)}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={bg}
        stroke={theme === "dark" ? "#0f172a" : "#f8fafc"}
        strokeWidth={1.5}
      />
      {showLabel && (
        <text
          x={x + 6}
          y={y + 16}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
          fontSize={11}
          fontWeight={700}
          fill={textColor}
        >
          {symbol}
        </text>
      )}
      {showPct && (
        <text
          x={x + 6}
          y={y + 30}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
          fontSize={10}
          fill={dimText}
        >
          {dailyLabel}
        </text>
      )}
    </g>
  );
}

export function PortfolioHeatmap({ tickers }: Props) {
  const router = useRouter();
  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  const priceVersion = usePortfolioVersion(symbols);
  const closeVersion = useDailyCloseVersion(symbols);
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    getThemeServerSnapshot,
  );

  const tiles = useMemo(
    () => buildTiles(tickers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickers, priceVersion, closeVersion],
  );

  if (tiles.length === 0) {
    return (
      <div className="px-6 py-12 text-center sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white/40 sm:dark:border-slate-800/70 sm:dark:bg-slate-900/40">
        <div className="font-mono text-xs uppercase tracking-widest text-slate-400 dark:text-slate-600">
          Waiting for prices…
        </div>
      </div>
    );
  }

  const tooltipBg = theme === "dark" ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.97)";
  const tooltipBorder = theme === "dark" ? "rgba(51, 65, 85, 0.7)" : "rgba(203, 213, 225, 0.8)";
  const tooltipText = theme === "dark" ? "#e2e8f0" : "#0f172a";

  return (
    <div className="overflow-hidden sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white/60 sm:dark:border-slate-800/70 sm:dark:bg-slate-900/40">
      <div className="h-[460px] w-full sm:h-[520px]">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={tiles}
            dataKey="size"
            nameKey="symbol"
            isAnimationActive={false}
            content={(props) =>
              renderTile(
                props as unknown as TreemapContentProps,
                theme,
                (s) => router.push(`/position/${encodeURIComponent(s)}`),
              )
            }
          >
            <Tooltip
              contentStyle={{
                background: tooltipBg,
                border: `1px solid ${tooltipBorder}`,
                borderRadius: 6,
                color: tooltipText,
                fontSize: 12,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                padding: "8px 10px",
              }}
              content={({ payload }) => {
                const tile = payload?.[0]?.payload as HeatTile | undefined;
                if (!tile) return null;
                const dailyLabel =
                  tile.dailyPct == null
                    ? "—"
                    : `${tile.dailyPct >= 0 ? "+" : ""}${tile.dailyPct.toFixed(2)}%`;
                return (
                  <div
                    style={{
                      background: tooltipBg,
                      border: `1px solid ${tooltipBorder}`,
                      color: tooltipText,
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{tile.symbol}</div>
                    {tile.name && (
                      <div style={{ opacity: 0.7, fontSize: 11 }}>{tile.name}</div>
                    )}
                    <div style={{ marginTop: 4 }}>
                      {formatMoney(tile.size)} ·{" "}
                      {(tile.percent * 100).toFixed(1)}%
                    </div>
                    <div>Day: {dailyLabel}</div>
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
