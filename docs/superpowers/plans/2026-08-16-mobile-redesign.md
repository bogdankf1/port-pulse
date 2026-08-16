# Mobile Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Port Pulse dashboard below 1024px so positions and today's move are visible on landing, with the charts moved into a bottom sheet.

**Architecture:** Pure calculation moves out of components into tested `lib/` modules that take an explicit quote map, following the existing `lib/mcp/portfolio.ts` pattern. A new public endpoint values a portfolio backwards through time, sharing its valuation core with `/api/compare`. Presentation splits at `lg` (1024px): below it a hero + compact row list + analytics sheet, above it today's untouched table.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Recharts, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-mobile-redesign-design.md`

---

## Before you start

Read the spec. It records why each decision was made and which alternatives lost.

**Testing reality — read this so you don't waste time.** `vitest.config.ts` sets
`environment: "node"` and `include: ["lib/**/*.test.ts"]`. That means:

- Only files under `lib/` are collected. A test at `hooks/foo.test.ts` or
  `components/foo.test.ts` **will never run**.
- There is no jsdom and no React Testing Library. **Do not write component
  tests.** Do not add either dependency — it is out of scope for this plan.

So: all logic worth testing goes in `lib/`, and components are verified with
`npx tsc --noEmit`, `npm run lint`, and a real browser at the end.

**Commands you will use repeatedly:**

```bash
npm test                 # vitest run — all lib tests
npx tsc --noEmit         # type check (there is no typecheck script)
npm run lint             # eslint
npm run dev              # dev server on :3000
```

**Branch:** work on `feat/mobile-redesign`, which already exists and holds the
spec commit.

---

## File structure

**New — tested**

| File | Responsibility |
|---|---|
| `lib/holdings.ts` | Pure portfolio maths: market value, cost basis, P&L, day change, weight, totals, sorting |
| `lib/holdings.test.ts` | Tests for the above |
| `lib/portfolioSeries.ts` | Snap-to-prior valuation of a holding set across a timeline |
| `lib/portfolioSeries.test.ts` | Tests for the above |
| `lib/portfolioHistory.ts` | Request validation + Yahoo fan-out for the new endpoint |
| `lib/portfolioHistory.test.ts` | Tests for the above |

**New — not tested (no jsdom)**

| File | Responsibility |
|---|---|
| `hooks/useQuotes.ts` | Live price + prev close as one `Quotes` map |
| `hooks/useIsDesktop.ts` | `matchMedia(min-width: 1024px)` via `useSyncExternalStore` |
| `hooks/usePortfolioHistory.ts` | Fetch/abort for `/api/portfolio-history` |
| `hooks/useRiskMetrics.ts` | Fetch/abort for `/api/risk`, extracted from `RiskMetricsPanel` |
| `components/mobile/HoldingRow.tsx` | One holding: collapsed and expanded |
| `components/mobile/SortChips.tsx` | Mobile sort control |
| `components/mobile/HoldingsList.tsx` | Chips + rows + total footer |
| `components/mobile/PortfolioHero.tsx` | Value, day change, P&L, sparkline, range chips |
| `components/mobile/AnalyticsSheet.tsx` | Peek/expanded shell + tabs |
| `components/mobile/RiskGauge.tsx` | One zoned metric scale |
| `components/mobile/sheet/MixTab.tsx` | Stacked bar, legend, concentration callout |
| `components/mobile/sheet/RiskTab.tsx` | Gauge list |
| `components/mobile/sheet/HeatmapTab.tsx` | Treemap wrapper |
| `components/mobile/sheet/InsightsTab.tsx` | Insights content |
| `app/api/portfolio-history/route.ts` | The new endpoint |

**Modified**

| File | Change |
|---|---|
| `types/index.ts` | Add `PortfolioHistoryResponse` |
| `components/PortfolioTable.tsx` | Desktop table only; maths imported |
| `components/WatchlistDashboard.tsx` | Branch on `useIsDesktop()` |
| `components/RiskMetricsPanel.tsx` | Consume `useRiskMetrics` |
| `components/SectorBreakdown.tsx` | Export `computeSlices` and `colorFor` |
| `components/PortfolioHeatmap.tsx` | Fold tiny tiles; tap-to-select |
| `app/api/compare/route.ts` | Import `computePortfolioValues` |
| `app/layout.tsx` | `viewport` export |
| `app/globals.css` | Reduced motion; drop fixed background below `lg` |

**Deleted**

| File | Reason |
|---|---|
| `components/TickerCard.tsx` | Replaced by `HoldingRow`. Imported only by `PortfolioTable` — verified |

---

## Task 1: Portfolio maths as a tested module

Extracts the pure functions currently inside `PortfolioTable.tsx` and adds day
change plus the new `day` sort column.

**Design note — why an explicit quote map.** The existing functions call
`getPriceSync` directly, which reads browser module state and cannot be tested
under `environment: "node"`. Taking a `Quotes` map as a parameter mirrors
`buildPortfolioDetail(rows, priceMap)` in `lib/mcp/portfolio.ts`, which is how
this codebase already separates maths from live data.

**⚠️ This task changes a displayed number.** Today's `computeTotals`
(`PortfolioTable.tsx:104-126`) accumulates market value for every priced
holding, but cost basis only for holdings that *also* have an entry price — then
returns `marketValue - costBasis`. In a portfolio where some holdings lack an
entry price, the reported total P&L is inflated by the full market value of
those holdings. Task 1 fixes this by tracking market value and cost basis over
the same subset. Total P&L will change for mixed portfolios. This is intentional;
step 1 pins it with a test.

**Files:**
- Create: `lib/holdings.ts`
- Test: `lib/holdings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/holdings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  computeTotals,
  dayChange,
  dayChangePct,
  defaultDir,
  marketValue,
  sortTickers,
  unrealizedPl,
  weightPct,
  type Quotes,
} from "./holdings";
import type { Ticker } from "@/types";

const AAPL: Ticker = { symbol: "AAPL", name: "Apple Inc.", quantity: 10, entryPrice: 100 };
const MSFT: Ticker = { symbol: "MSFT", name: "Microsoft", quantity: 5, entryPrice: 200 };
const NVDA: Ticker = { symbol: "NVDA", name: "Nvidia", quantity: 4 }; // no entry price
const CASH: Ticker = { symbol: "CASH", name: "Cash" }; // no quantity

function quotes(entries: Record<string, [number | null, number | null]>): Quotes {
  return new Map(
    Object.entries(entries).map(([s, [price, prevClose]]) => [s, { price, prevClose }]),
  );
}

describe("per-holding maths", () => {
  const q = quotes({ AAPL: [150, 140], MSFT: [190, 200], NVDA: [50, 50] });

  it("computes market value, P&L and weight", () => {
    expect(marketValue(AAPL, q)).toBe(1500);
    expect(unrealizedPl(AAPL, q)).toBe(500);
    expect(weightPct(AAPL, q, 3000)).toBe(50);
  });

  it("returns null when quantity is unknown", () => {
    expect(marketValue(CASH, q)).toBeNull();
    expect(unrealizedPl(CASH, q)).toBeNull();
    expect(dayChange(CASH, q)).toBeNull();
  });

  it("returns null P&L when entry price is unknown", () => {
    expect(marketValue(NVDA, q)).toBe(200);
    expect(unrealizedPl(NVDA, q)).toBeNull();
  });

  it("computes day change in dollars and percent", () => {
    expect(dayChange(AAPL, q)).toBeCloseTo(100, 10);
    expect(dayChangePct(AAPL, q)).toBeCloseTo(7.142857, 5);
    expect(dayChange(MSFT, q)).toBeCloseTo(-50, 10);
    expect(dayChangePct(MSFT, q)).toBeCloseTo(-5, 10);
  });

  it("returns null day change when prev close is missing or zero", () => {
    expect(dayChange(AAPL, quotes({ AAPL: [150, null] }))).toBeNull();
    expect(dayChangePct(AAPL, quotes({ AAPL: [150, 0] }))).toBeNull();
  });

  it("returns null weight when the portfolio has no value", () => {
    expect(weightPct(AAPL, q, 0)).toBeNull();
  });
});

describe("computeTotals", () => {
  it("sums value, cost basis, P&L and day change", () => {
    const q = quotes({ AAPL: [150, 140], MSFT: [190, 200] });
    const t = computeTotals([AAPL, MSFT], q);
    expect(t.marketValue).toBe(2450);
    expect(t.costBasis).toBe(2000);
    expect(t.pl).toBe(450);
    expect(t.dayChange).toBeCloseTo(50, 10);
    // prev-close base is 10*140 + 5*200 = 2400
    expect(t.dayChangePct).toBeCloseTo((50 / 2400) * 100, 10);
    expect(t.hasAnyValue).toBe(true);
  });

  it("excludes holdings without an entry price from P&L on BOTH sides", () => {
    const q = quotes({ AAPL: [150, 140], NVDA: [50, 50] });
    const t = computeTotals([AAPL, NVDA], q);
    expect(t.marketValue).toBe(1700); // 1500 + 200 — full portfolio value
    expect(t.costBasis).toBe(1000); // AAPL only
    expect(t.pl).toBe(500); // NOT 700 — NVDA's value must not inflate P&L
  });

  it("returns null P&L when no holding has an entry price", () => {
    const t = computeTotals([NVDA], quotes({ NVDA: [50, 50] }));
    expect(t.pl).toBeNull();
  });

  it("returns null day change when no prev close is known", () => {
    const t = computeTotals([AAPL], quotes({ AAPL: [150, null] }));
    expect(t.dayChange).toBeNull();
    expect(t.dayChangePct).toBeNull();
  });

  it("reports no value for an unpriced portfolio", () => {
    const t = computeTotals([AAPL], quotes({}));
    expect(t.hasAnyValue).toBe(false);
    expect(t.marketValue).toBe(0);
  });
});

describe("sortTickers", () => {
  const q = quotes({ AAPL: [150, 140], MSFT: [190, 200], NVDA: [50, 50] });
  const ctx = { quotes: q, totalValue: 2450 };
  const all = [AAPL, MSFT, NVDA];

  it("returns the input untouched when there is no sort", () => {
    expect(sortTickers(all, null, ctx)).toBe(all);
  });

  it("does not mutate the input array", () => {
    const input = [...all];
    sortTickers(input, { column: "ticker", direction: "asc" }, ctx);
    expect(input).toEqual(all);
  });

  it("sorts by ticker alphabetically", () => {
    const out = sortTickers(all, { column: "ticker", direction: "asc" }, ctx);
    expect(out.map((t) => t.symbol)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("sorts by day change percent descending", () => {
    const out = sortTickers(all, { column: "day", direction: "desc" }, ctx);
    expect(out.map((t) => t.symbol)).toEqual(["AAPL", "NVDA", "MSFT"]);
  });

  it("sorts by value descending", () => {
    const out = sortTickers(all, { column: "value", direction: "desc" }, ctx);
    expect(out.map((t) => t.symbol)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("puts nulls last regardless of direction", () => {
    const withNull = [...all, CASH];
    const desc = sortTickers(withNull, { column: "value", direction: "desc" }, ctx);
    expect(desc[desc.length - 1].symbol).toBe("CASH");
    const asc = sortTickers(withNull, { column: "value", direction: "asc" }, ctx);
    expect(asc[asc.length - 1].symbol).toBe("CASH");
  });

  it("resolves names through nameFor when the ticker has none", () => {
    const anon: Ticker = { symbol: "ZZZ", name: "" };
    const out = sortTickers([anon, AAPL], { column: "name", direction: "asc" }, {
      ...ctx,
      nameFor: (s) => (s === "ZZZ" ? "Aardvark Corp" : undefined),
    });
    expect(out.map((t) => t.symbol)).toEqual(["ZZZ", "AAPL"]);
  });
});

describe("defaultDir", () => {
  it("defaults numeric columns to descending and text to ascending", () => {
    expect(defaultDir("value")).toBe("desc");
    expect(defaultDir("day")).toBe("desc");
    expect(defaultDir("ticker")).toBe("asc");
    expect(defaultDir("name")).toBe("asc");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/holdings.test.ts`
Expected: FAIL — `Failed to resolve import "./holdings"`.

- [ ] **Step 3: Write the implementation**

Create `lib/holdings.ts`:

```ts
import type { Ticker } from "@/types";

/** A symbol's live price and its previous session close. Either may be unknown. */
export type Quote = { price: number | null; prevClose: number | null };
export type Quotes = ReadonlyMap<string, Quote>;

const EMPTY_QUOTE: Quote = { price: null, prevClose: null };

export function quoteFor(quotes: Quotes, symbol: string): Quote {
  return quotes.get(symbol) ?? EMPTY_QUOTE;
}

export type SortColumn =
  | "ticker"
  | "name"
  | "qty"
  | "entry"
  | "current"
  | "value"
  | "pl"
  | "percent"
  | "day";
export type SortDir = "asc" | "desc";
export type SortState = { column: SortColumn; direction: SortDir };

const NUMERIC: ReadonlySet<SortColumn> = new Set([
  "qty",
  "entry",
  "current",
  "value",
  "pl",
  "percent",
  "day",
]);

export function defaultDir(col: SortColumn): SortDir {
  return NUMERIC.has(col) ? "desc" : "asc";
}

export type SortContext = {
  quotes: Quotes;
  totalValue: number;
  /** Falls back to a profile-derived name when the ticker carries none. */
  nameFor?: (symbol: string) => string | undefined;
};

export function marketValue(t: Ticker, quotes: Quotes): number | null {
  const { price } = quoteFor(quotes, t.symbol);
  if (price == null || t.quantity == null) return null;
  return price * t.quantity;
}

export function costBasis(t: Ticker): number | null {
  if (t.entryPrice == null || t.quantity == null) return null;
  return t.entryPrice * t.quantity;
}

export function unrealizedPl(t: Ticker, quotes: Quotes): number | null {
  const value = marketValue(t, quotes);
  const cost = costBasis(t);
  if (value == null || cost == null) return null;
  return value - cost;
}

/** Today's move in dollars. Needs price, prev close and quantity. */
export function dayChange(t: Ticker, quotes: Quotes): number | null {
  const { price, prevClose } = quoteFor(quotes, t.symbol);
  if (price == null || prevClose == null || prevClose <= 0) return null;
  if (t.quantity == null) return null;
  return (price - prevClose) * t.quantity;
}

/** Today's move as a percent of prev close. Independent of quantity. */
export function dayChangePct(t: Ticker, quotes: Quotes): number | null {
  const { price, prevClose } = quoteFor(quotes, t.symbol);
  if (price == null || prevClose == null || prevClose <= 0) return null;
  return ((price - prevClose) / prevClose) * 100;
}

export function weightPct(
  t: Ticker,
  quotes: Quotes,
  totalValue: number,
): number | null {
  const value = marketValue(t, quotes);
  if (value == null || totalValue <= 0) return null;
  return (value / totalValue) * 100;
}

export type Totals = {
  marketValue: number;
  costBasis: number;
  pl: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  hasAnyValue: boolean;
};

export function computeTotals(tickers: Ticker[], quotes: Quotes): Totals {
  let totalValue = 0;
  let basis = 0;
  // Market value of only those holdings that also have a cost basis, so that
  // P&L is a like-for-like difference. Summing full market value against a
  // partial cost basis inflates P&L — see the spec's note on this fix.
  let pricedWithBasis = 0;
  let day = 0;
  let dayBase = 0;
  let hasAnyValue = false;
  let hasAnyBasis = false;
  let hasAnyDay = false;

  for (const t of tickers) {
    const value = marketValue(t, quotes);
    if (value != null) {
      totalValue += value;
      hasAnyValue = true;
    }
    const cost = costBasis(t);
    if (value != null && cost != null) {
      basis += cost;
      pricedWithBasis += value;
      hasAnyBasis = true;
    }
    const d = dayChange(t, quotes);
    if (d != null && t.quantity != null) {
      const { prevClose } = quoteFor(quotes, t.symbol);
      if (prevClose != null) {
        day += d;
        dayBase += prevClose * t.quantity;
        hasAnyDay = true;
      }
    }
  }

  return {
    marketValue: totalValue,
    costBasis: basis,
    pl: hasAnyBasis ? pricedWithBasis - basis : null,
    dayChange: hasAnyDay ? day : null,
    dayChangePct: hasAnyDay && dayBase > 0 ? (day / dayBase) * 100 : null,
    hasAnyValue,
  };
}

export function sortValue(
  t: Ticker,
  col: SortColumn,
  ctx: SortContext,
): string | number | null {
  switch (col) {
    case "ticker":
      return t.symbol;
    case "name": {
      const n = t.name || ctx.nameFor?.(t.symbol) || "";
      return n || null;
    }
    case "qty":
      return t.quantity ?? null;
    case "entry":
      return t.entryPrice ?? null;
    case "current":
      return quoteFor(ctx.quotes, t.symbol).price;
    case "value":
      return marketValue(t, ctx.quotes);
    case "pl":
      return unrealizedPl(t, ctx.quotes);
    case "percent":
      return weightPct(t, ctx.quotes, ctx.totalValue);
    case "day":
      return dayChangePct(t, ctx.quotes);
  }
}

export function sortTickers(
  tickers: Ticker[],
  sort: SortState | null,
  ctx: SortContext,
): Ticker[] {
  if (!sort) return tickers;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...tickers].sort((a, b) => {
    const va = sortValue(a, sort.column, ctx);
    const vb = sortValue(b, sort.column, ctx);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" && typeof vb === "string") {
      return va.localeCompare(vb) * dir;
    }
    return ((va as number) - (vb as number)) * dir;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/holdings.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/holdings.ts lib/holdings.test.ts
git commit -m "feat(holdings): extract portfolio maths into a tested module

Takes an explicit quote map rather than reading browser price state, so the
maths is testable under vitest's node environment. Adds day change in dollars
and percent, and a 'day' sort column.

Fixes total P&L: market value and cost basis are now summed over the same
subset of holdings. Previously a holding without an entry price contributed
its full market value to P&L with no offsetting cost."
```

---

## Task 2: Point the desktop table at the shared maths

Behaviour-preserving refactor. The table must look and sort exactly as it does
now, apart from the P&L fix from Task 1.

**Files:**
- Create: `hooks/useQuotes.ts`
- Modify: `components/PortfolioTable.tsx` (delete lines 17-126, rewrite the component body)

- [ ] **Step 1: Create the quotes hook**

Create `hooks/useQuotes.ts`:

```ts
"use client";

import { useMemo } from "react";
import { getPriceSync, usePortfolioVersion } from "@/lib/finnhub";
import { getDailyCloseSync, useDailyCloseVersion } from "@/lib/dailyClose";
import type { Quotes } from "@/lib/holdings";

/**
 * Live price + previous close for each symbol, as one map.
 *
 * Subscribing here is also what makes prev close available beyond the heatmap —
 * `useDailyCloseVersion` triggers the fetch for any symbol passed in.
 */
export function useQuotes(symbols: string[]): Quotes {
  const priceVersion = usePortfolioVersion(symbols);
  const closeVersion = useDailyCloseVersion(symbols);
  const key = symbols.join("|");

  return useMemo(() => {
    const map = new Map<string, { price: number | null; prevClose: number | null }>();
    for (const symbol of symbols) {
      map.set(symbol, {
        price: getPriceSync(symbol) ?? null,
        prevClose: getDailyCloseSync(symbol) ?? null,
      });
    }
    return map;
    // `key` stands in for `symbols`; the version counters force a rebuild on tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, priceVersion, closeVersion]);
}
```

- [ ] **Step 2: Rewrite PortfolioTable's head**

In `components/PortfolioTable.tsx`, replace everything from the imports through
the end of `computeTotals` (lines 1-126) with:

```tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { TickerTableRow } from "./TickerTableRow";
import { ConfirmModal } from "./ConfirmModal";
import { useQuotes } from "@/hooks/useQuotes";
import {
  computeTotals,
  defaultDir,
  sortTickers,
  type SortColumn,
  type SortState,
} from "@/lib/holdings";
import { getProfileNameSync } from "@/lib/profile";
import { formatMoney, plColor } from "@/lib/format";
import type { Ticker } from "@/types";

type Props = {
  tickers: Ticker[];
  onRemove: (symbol: string) => void;
};
```

Note `TickerCard` is no longer imported — it is deleted in Task 9.

- [ ] **Step 3: Rewrite the component body**

Replace the body of `PortfolioTable` down to its `return` with:

```tsx
export function PortfolioTable({ tickers, onRemove }: Props) {
  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  const quotes = useQuotes(symbols);
  const [sort, setSort] = useState<SortState | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  const requestRemove = (symbol: string) => setPendingRemoval(symbol);

  const totals = useMemo(() => computeTotals(tickers, quotes), [tickers, quotes]);

  const sortedTickers = useMemo(
    () =>
      sortTickers(tickers, sort, {
        quotes,
        totalValue: totals.marketValue,
        nameFor: getProfileNameSync,
      }),
    [tickers, sort, quotes, totals.marketValue],
  );

  function toggle(col: SortColumn) {
    setSort((prev) => {
      if (prev?.column === col) {
        return {
          column: col,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { column: col, direction: defaultDir(col) };
    });
  }

  const totalPlPositive = totals.pl != null && totals.pl >= 0;
  const totalPlPct =
    totals.pl != null && totals.costBasis > 0
      ? (totals.pl / totals.costBasis) * 100
      : null;
  const totalPlColor = totals.pl == null ? "text-slate-500" : plColor(totals.pl);
```

- [ ] **Step 4: Delete the mobile branch and change the desktop breakpoint**

In the returned JSX, delete the entire `{/* Mobile: card list (< sm) */}` block
(old lines 169-206). On the wrapper that follows it, change `sm:block` to
`lg:block`:

```tsx
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white/60 dark:border-slate-800/70 dark:bg-slate-900/40 lg:block">
```

Leave the `<table>`, `<thead>`, `<tbody>`, `<tfoot>`, `ConfirmModal` and
`SortHeader` exactly as they are.

- [ ] **Step 5: Verify nothing else referenced the deleted exports**

Run: `grep -rn "computeTotals\|sortTickers\|sortValue" components app lib hooks`
Expected: hits only in `lib/holdings.ts`, `lib/holdings.test.ts` and
`components/PortfolioTable.tsx`.

- [ ] **Step 6: Type check and lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add hooks/useQuotes.ts components/PortfolioTable.tsx
git commit -m "refactor(table): use shared holdings maths and useQuotes

Desktop table now imports from lib/holdings and drops its private copies.
Its mobile card branch is removed ahead of the new mobile layout, and the
desktop breakpoint moves from sm to lg."
```

---

## Task 3: Portfolio valuation across a timeline

Extracts `computePortfolioValues` from `app/api/compare/route.ts:256-287` so the
compare route and the new endpoint cannot drift.

**Files:**
- Create: `lib/portfolioSeries.ts`
- Test: `lib/portfolioSeries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/portfolioSeries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  alignedTimes,
  buildPortfolioSeries,
  computePortfolioValues,
  type HoldingHistory,
} from "./portfolioSeries";

function history(
  symbol: string,
  quantity: number,
  points: [number, number][],
): HoldingHistory {
  return {
    holding: { symbol, quantity },
    points: points.map(([time, value]) => ({ time, value })),
  };
}

describe("alignedTimes", () => {
  it("returns the union of timestamps at or after the latest start", () => {
    const a = history("A", 1, [[10, 1], [20, 2], [30, 3]]);
    const b = history("B", 1, [[20, 5], [30, 6]]);
    expect(alignedTimes([a, b])).toEqual([20, 30]);
  });

  it("deduplicates and sorts", () => {
    const a = history("A", 1, [[30, 1], [10, 2], [20, 3]]);
    const b = history("B", 1, [[10, 5], [20, 6], [30, 7]]);
    expect(alignedTimes([a, b])).toEqual([10, 20, 30]);
  });

  it("returns nothing for an empty input", () => {
    expect(alignedTimes([])).toEqual([]);
  });
});

describe("computePortfolioValues", () => {
  it("multiplies quantity by price and sums across holdings", () => {
    const a = history("A", 2, [[10, 100], [20, 110]]);
    const b = history("B", 3, [[10, 10], [20, 20]]);
    expect(computePortfolioValues([10, 20], [a, b])).toEqual([
      { time: 10, value: 230 },
      { time: 20, value: 280 },
    ]);
  });

  it("snaps to the most recent price at or before each time", () => {
    // B has no point at t=20, so its t=10 price carries forward.
    const a = history("A", 1, [[10, 100], [20, 200]]);
    const b = history("B", 1, [[10, 5], [30, 9]]);
    expect(computePortfolioValues([10, 20, 30], [a, b])).toEqual([
      { time: 10, value: 105 },
      { time: 20, value: 205 },
      { time: 30, value: 209 },
    ]);
  });

  it("skips times where a holding has no prior price", () => {
    const a = history("A", 1, [[10, 100], [20, 200]]);
    const b = history("B", 1, [[20, 5]]);
    // At t=10, B has nothing at or before it, so that point is dropped.
    expect(computePortfolioValues([10, 20], [a, b])).toEqual([
      { time: 20, value: 205 },
    ]);
  });
});

describe("buildPortfolioSeries", () => {
  it("aligns then values in one call", () => {
    const a = history("A", 1, [[10, 100], [20, 200]]);
    const b = history("B", 2, [[20, 5], [30, 6]]);
    expect(buildPortfolioSeries([a, b])).toEqual([
      { time: 20, value: 210 },
      { time: 30, value: 212 },
    ]);
  });

  it("returns an empty series when no holding has history", () => {
    expect(buildPortfolioSeries([])).toEqual([]);
  });

  it("returns an empty series when a holding has no points", () => {
    expect(buildPortfolioSeries([history("A", 1, [])])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/portfolioSeries.test.ts`
Expected: FAIL — `Failed to resolve import "./portfolioSeries"`.

- [ ] **Step 3: Write the implementation**

Create `lib/portfolioSeries.ts`:

```ts
import type { HistoryPoint } from "@/types";

export type SeriesHolding = { symbol: string; quantity: number };
export type HoldingHistory = {
  holding: SeriesHolding;
  points: HistoryPoint[];
};
export type SeriesPoint = { time: number; value: number };

/**
 * Union of every timestamp at or after the latest first-point across holdings.
 *
 * Anchoring on the latest start means a recently-listed symbol truncates the
 * series rather than silently valuing the portfolio as if it did not exist.
 */
export function alignedTimes(histories: HoldingHistory[]): number[] {
  const usable = histories.filter((h) => h.points.length > 0);
  if (usable.length === 0) return [];

  const latestStart = usable.reduce(
    (acc, h) => Math.max(acc, h.points[0].time),
    0,
  );

  const times = new Set<number>();
  for (const h of usable) {
    for (const p of h.points) {
      if (p.time >= latestStart) times.add(p.time);
    }
  }
  return Array.from(times).sort((a, b) => a - b);
}

/**
 * Value the holding set at each time, using each symbol's most recent price at
 * or before that time. A time where any holding has no prior price is dropped,
 * so the series never mixes a partial portfolio with a full one.
 */
export function computePortfolioValues(
  times: number[],
  histories: HoldingHistory[],
): SeriesPoint[] {
  const usable = histories.filter((h) => h.points.length > 0);
  if (usable.length === 0) return [];

  const pointers = new Map<string, number>();
  for (const h of usable) pointers.set(h.holding.symbol, 0);

  const out: SeriesPoint[] = [];
  for (const t of times) {
    let total = 0;
    let allPriced = true;
    for (const h of usable) {
      const symbol = h.holding.symbol;
      const points = h.points;
      let i = pointers.get(symbol) ?? 0;
      while (i + 1 < points.length && points[i + 1].time <= t) i++;
      pointers.set(symbol, i);
      const price = points[i].time <= t ? points[i].value : undefined;
      if (typeof price !== "number" || !Number.isFinite(price)) {
        allPriced = false;
        break;
      }
      total += h.holding.quantity * price;
    }
    if (allPriced && Number.isFinite(total)) {
      out.push({ time: t, value: total });
    }
  }
  return out;
}

export function buildPortfolioSeries(
  histories: HoldingHistory[],
): SeriesPoint[] {
  const times = alignedTimes(histories);
  if (times.length === 0) return [];
  return computePortfolioValues(times, histories);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/portfolioSeries.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolioSeries.ts lib/portfolioSeries.test.ts
git commit -m "feat(series): extract portfolio timeline valuation

Snap-to-prior valuation lifted out of the compare route so the upcoming
portfolio-history endpoint shares one implementation."
```

---

## Task 4: Point the compare route at the shared valuation

Pure refactor. `/api/compare` responses must not change.

**Files:**
- Modify: `app/api/compare/route.ts`

- [ ] **Step 1: Import the shared helpers**

Add to the imports at the top of `app/api/compare/route.ts`:

```ts
import {
  alignedTimes,
  computePortfolioValues,
  type HoldingHistory,
} from "@/lib/portfolioSeries";
```

- [ ] **Step 2: Delete the local copies**

Delete `type HoldingHistory = { holding: Holding; points: HistoryPoint[] };` and
the whole `function computePortfolioValues(...)` block (lines 254-287).

The local `Holding` type (line 29) keeps its `portfolioId` field and stays — it
is structurally assignable to `SeriesHolding`, so no change is needed there.

- [ ] **Step 3: Use the shared aligner in the portfolio loop**

Inside the `for (const meta of portfolioMeta)` loop, replace the block that runs
from `const latestStart = ...` down to `if (times.length === 0) continue;` with:

```ts
    const times = alignedTimes(symbolHistories as HoldingHistory[]);
    if (times.length === 0) continue;
```

Leave the following line as-is:

```ts
    const seriesValues = computePortfolioValues(times, symbolHistories as HoldingHistory[]);
```

- [ ] **Step 4: Confirm the `HistoryPoint` import is still used**

Run: `grep -n "HistoryPoint" app/api/compare/route.ts`
Expected: still referenced by `historyBySymbol`. If it is not, remove it from
the import to keep lint clean.

- [ ] **Step 5: Type check and lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no errors.

- [ ] **Step 6: Verify the compare page still works**

Run: `npm run dev`, sign in, open `/compare`, select a portfolio and SPY at 1Y.
Expected: the chart renders exactly as before.

- [ ] **Step 7: Commit**

```bash
git add app/api/compare/route.ts
git commit -m "refactor(compare): use shared portfolio series helpers"
```

---

## Task 5: Portfolio history validation and fan-out

**Files:**
- Create: `lib/portfolioHistory.ts`
- Test: `lib/portfolioHistory.test.ts`
- Modify: `types/index.ts`

- [ ] **Step 1: Add the response type**

Append to `types/index.ts`:

```ts
export type PortfolioHistoryRange = "1D" | "1M" | "3M" | "YTD" | "1Y";

export type PortfolioHistoryResponse = {
  range: PortfolioHistoryRange;
  points: HistoryPoint[];
  startValue: number | null;
  endValue: number | null;
  missing_symbols: string[];
  caveat: string;
};
```

- [ ] **Step 2: Write the failing tests**

Create `lib/portfolioHistory.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchYahooChart = vi.fn();

vi.mock("./yahoo", () => ({
  fetchYahooChart: (...args: unknown[]) => fetchYahooChart(...args),
  YahooFetchError: class YahooFetchError extends Error {
    status = 502;
  },
}));

const { buildPortfolioHistory, isPortfolioHistoryRange, sanitizeHoldings } =
  await import("./portfolioHistory");

beforeEach(() => {
  fetchYahooChart.mockReset();
});

describe("isPortfolioHistoryRange", () => {
  it("accepts the supported ranges", () => {
    for (const r of ["1D", "1M", "3M", "YTD", "1Y"]) {
      expect(isPortfolioHistoryRange(r)).toBe(true);
    }
  });

  it("rejects 5Y, unknown strings and non-strings", () => {
    expect(isPortfolioHistoryRange("5Y")).toBe(false);
    expect(isPortfolioHistoryRange("1W")).toBe(false);
    expect(isPortfolioHistoryRange(null)).toBe(false);
    expect(isPortfolioHistoryRange(1)).toBe(false);
  });
});

describe("sanitizeHoldings", () => {
  it("keeps well-formed holdings and upper-cases symbols", () => {
    expect(sanitizeHoldings([{ symbol: "aapl", quantity: 3 }])).toEqual([
      { symbol: "AAPL", quantity: 3 },
    ]);
  });

  it("drops bad symbols, bad quantities and non-objects", () => {
    const out = sanitizeHoldings([
      { symbol: "TOOLONGSYM", quantity: 1 },
      { symbol: "AAPL", quantity: 0 },
      { symbol: "AAPL", quantity: -2 },
      { symbol: "AAPL", quantity: Number.NaN },
      { symbol: "AAPL" },
      { quantity: 5 },
      "nope",
      null,
      { symbol: "MSFT", quantity: 2 },
    ]);
    expect(out).toEqual([{ symbol: "MSFT", quantity: 2 }]);
  });

  it("returns nothing for a non-array", () => {
    expect(sanitizeHoldings(undefined)).toEqual([]);
    expect(sanitizeHoldings({})).toEqual([]);
  });

  it("caps at 60 holdings", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      symbol: "AAPL",
      quantity: i + 1,
    }));
    expect(sanitizeHoldings(many)).toHaveLength(60);
  });
});

describe("buildPortfolioHistory", () => {
  it("values the portfolio over the aligned timeline", async () => {
    fetchYahooChart.mockImplementation(async (symbol: string) => {
      if (symbol === "AAPL") {
        return { points: [{ time: 10, value: 100 }, { time: 20, value: 110 }] };
      }
      return { points: [{ time: 10, value: 10 }, { time: 20, value: 20 }] };
    });

    const result = await buildPortfolioHistory(
      [
        { symbol: "AAPL", quantity: 2 },
        { symbol: "MSFT", quantity: 3 },
      ],
      "1M",
    );

    expect(result.range).toBe("1M");
    expect(result.points).toEqual([
      { time: 10, value: 230 },
      { time: 20, value: 280 },
    ]);
    expect(result.startValue).toBe(230);
    expect(result.endValue).toBe(280);
    expect(result.missing_symbols).toEqual([]);
    expect(result.caveat).toContain("current holdings");
  });

  it("reports symbols whose history could not be fetched and excludes them", async () => {
    fetchYahooChart.mockImplementation(async (symbol: string) => {
      if (symbol === "AAPL") {
        return { points: [{ time: 10, value: 100 }, { time: 20, value: 110 }] };
      }
      throw new Error("upstream down");
    });

    const result = await buildPortfolioHistory(
      [
        { symbol: "AAPL", quantity: 2 },
        { symbol: "MSFT", quantity: 3 },
      ],
      "1M",
    );

    expect(result.missing_symbols).toEqual(["MSFT"]);
    expect(result.points).toEqual([
      { time: 10, value: 200 },
      { time: 20, value: 220 },
    ]);
  });

  it("treats an empty point list as a missing symbol", async () => {
    fetchYahooChart.mockResolvedValue({ points: [] });
    const result = await buildPortfolioHistory(
      [{ symbol: "AAPL", quantity: 2 }],
      "1D",
    );
    expect(result.missing_symbols).toEqual(["AAPL"]);
    expect(result.points).toEqual([]);
    expect(result.startValue).toBeNull();
    expect(result.endValue).toBeNull();
  });

  it("fetches each unique symbol once", async () => {
    fetchYahooChart.mockResolvedValue({
      points: [{ time: 10, value: 100 }],
    });
    await buildPortfolioHistory(
      [
        { symbol: "AAPL", quantity: 1 },
        { symbol: "AAPL", quantity: 2 },
      ],
      "1M",
    );
    expect(fetchYahooChart).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- lib/portfolioHistory.test.ts`
Expected: FAIL — cannot resolve `./portfolioHistory`.

- [ ] **Step 4: Write the implementation**

Create `lib/portfolioHistory.ts`:

```ts
import { fetchYahooChart } from "@/lib/yahoo";
import {
  buildPortfolioSeries,
  type HoldingHistory,
  type SeriesHolding,
} from "@/lib/portfolioSeries";
import type {
  HistoryPoint,
  PortfolioHistoryRange,
  PortfolioHistoryResponse,
} from "@/types";

// The single declaration of this union lives in types/index.ts — do not
// redeclare it here, or the endpoint and the response type can drift apart.
export const PORTFOLIO_HISTORY_RANGES: readonly PortfolioHistoryRange[] = [
  "1D",
  "1M",
  "3M",
  "YTD",
  "1Y",
] as const;

/**
 * The series values today's holdings backwards through time. It is not a
 * record of what the account was actually worth. Surfaced in the UI.
 */
export const PORTFOLIO_HISTORY_CAVEAT =
  "Portfolio history reflects your current holdings throughout the period. Past buys and sells aren't accounted for.";

// Kept identical to app/api/risk/route.ts so the two public computation
// endpoints accept exactly the same holdings.
const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
const MAX_TICKERS = 60;

export function isPortfolioHistoryRange(
  v: unknown,
): v is PortfolioHistoryRange {
  return (
    typeof v === "string" &&
    (PORTFOLIO_HISTORY_RANGES as readonly string[]).includes(v)
  );
}

export function sanitizeHoldings(raw: unknown): SeriesHolding[] {
  if (!Array.isArray(raw)) return [];
  const out: SeriesHolding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const symbol =
      typeof obj.symbol === "string" ? obj.symbol.trim().toUpperCase() : null;
    if (!symbol || !SYMBOL_RE.test(symbol)) continue;
    const qty = typeof obj.quantity === "number" ? obj.quantity : null;
    if (qty == null || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ symbol, quantity: qty });
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

export async function buildPortfolioHistory(
  holdings: SeriesHolding[],
  range: PortfolioHistoryRange,
): Promise<PortfolioHistoryResponse> {
  const uniqueSymbols = Array.from(new Set(holdings.map((h) => h.symbol)));

  const fetched = await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      try {
        const res = await fetchYahooChart(symbol, range);
        return [symbol, res.points as HistoryPoint[]] as const;
      } catch {
        return [symbol, null] as const;
      }
    }),
  );

  const bySymbol = new Map<string, HistoryPoint[]>();
  const missing: string[] = [];
  for (const [symbol, points] of fetched) {
    if (points && points.length > 0) bySymbol.set(symbol, points);
    else missing.push(symbol);
  }

  const histories: HoldingHistory[] = holdings
    .filter((h) => bySymbol.has(h.symbol))
    .map((h) => ({ holding: h, points: bySymbol.get(h.symbol)! }));

  const points = buildPortfolioSeries(histories);

  return {
    range,
    points,
    startValue: points.length > 0 ? points[0].value : null,
    endValue: points.length > 0 ? points[points.length - 1].value : null,
    missing_symbols: missing,
    caveat: PORTFOLIO_HISTORY_CAVEAT,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- lib/portfolioHistory.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/portfolioHistory.ts lib/portfolioHistory.test.ts types/index.ts
git commit -m "feat(history): portfolio history validation and Yahoo fan-out"
```

---

## Task 6: The `/api/portfolio-history` endpoint

Deliberately mirrors `app/api/risk/route.ts` — same POST shape, same validation,
no authentication, so a signed-out `sessionStorage` watchlist charts normally.

**Files:**
- Create: `app/api/portfolio-history/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/portfolio-history/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  buildPortfolioHistory,
  isPortfolioHistoryRange,
  PORTFOLIO_HISTORY_RANGES,
  sanitizeHoldings,
} from "@/lib/portfolioHistory";

export const runtime = "nodejs";

type RequestBody = { tickers?: unknown; range?: unknown };

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isPortfolioHistoryRange(body.range)) {
    return NextResponse.json(
      { error: `Invalid range. Allowed: ${PORTFOLIO_HISTORY_RANGES.join(", ")}` },
      { status: 400 },
    );
  }

  const holdings = sanitizeHoldings(body.tickers);
  if (holdings.length === 0) {
    return NextResponse.json(
      { error: "No holdings with quantity to chart" },
      { status: 400 },
    );
  }

  try {
    const result = await buildPortfolioHistory(holdings, body.range);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to build portfolio history" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Exercise the endpoint by hand**

Start `npm run dev`, then in another terminal:

```bash
curl -s localhost:3000/api/portfolio-history \
  -H 'content-type: application/json' \
  -d '{"range":"1M","tickers":[{"symbol":"AAPL","quantity":10},{"symbol":"MSFT","quantity":5}]}' \
  | head -c 400
```

Expected: JSON with `"range":"1M"`, a non-empty `points` array of
`{time, value}`, numeric `startValue`/`endValue`, `"missing_symbols":[]`.

Then check the rejections:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/portfolio-history \
  -H 'content-type: application/json' -d '{"range":"5Y","tickers":[{"symbol":"AAPL","quantity":1}]}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/portfolio-history \
  -H 'content-type: application/json' -d '{"range":"1M","tickers":[]}'
```

Expected: `400` then `400`.

- [ ] **Step 4: Commit**

```bash
git add app/api/portfolio-history/route.ts
git commit -m "feat(api): add POST /api/portfolio-history

Public endpoint mirroring /api/risk, so the hero chart works signed out and
supports 1D — neither of which /api/compare can do."
```

---

## Task 7: The holding row

**Files:**
- Create: `components/mobile/HoldingRow.tsx`

- [ ] **Step 1: Write the component**

Create `components/mobile/HoldingRow.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCompanyProfile } from "@/lib/profile";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import {
  costBasis,
  dayChange,
  dayChangePct,
  marketValue,
  quoteFor,
  unrealizedPl,
  weightPct,
  type Quotes,
} from "@/lib/holdings";
import { formatMoney, formatQty, plColor } from "@/lib/format";
import type { Ticker } from "@/types";

type Props = {
  ticker: Ticker;
  quotes: Quotes;
  totalValue: number;
  onRemove: () => void;
};

function signed(n: number, format: (v: number) => string): string {
  return `${n >= 0 ? "+" : "−"}${format(Math.abs(n))}`;
}

export function HoldingRow({ ticker, quotes, totalValue, onRemove }: Props) {
  const router = useRouter();
  const profile = useCompanyProfile(ticker.symbol);
  const [expanded, setExpanded] = useState(false);

  const { price } = quoteFor(quotes, ticker.symbol);
  const flashClass = usePriceFlash(price);

  const value = marketValue(ticker, quotes);
  const pl = unrealizedPl(ticker, quotes);
  const cost = costBasis(ticker);
  const plPct = pl != null && cost != null && cost > 0 ? (pl / cost) * 100 : null;
  const dayPct = dayChangePct(ticker, quotes);
  const dayAbs = dayChange(ticker, quotes);
  const weight = weightPct(ticker, quotes, totalValue);

  // Weight fill tinted by today's direction. If this reads as noise on a red
  // day, swap both branches for `bg-slate-500/10` — see the spec's risk note.
  const fillClass =
    dayPct == null
      ? "bg-slate-400/10 dark:bg-slate-500/10"
      : dayPct >= 0
        ? "bg-emerald-500/10 dark:bg-emerald-400/10"
        : "bg-red-500/10 dark:bg-red-400/10";

  return (
    <div
      className={`relative border-b border-slate-200 dark:border-slate-800/70 ${flashClass}`}
    >
      {weight != null && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 left-0 ${fillClass}`}
          style={{ width: `${Math.min(100, weight)}%` }}
        />
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="relative flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        {profile.logo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={profile.logo}
            alt=""
            className="h-7 w-7 shrink-0 rounded bg-white object-contain p-0.5 ring-1 ring-slate-200 dark:bg-slate-100 dark:ring-slate-700"
            loading="lazy"
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-slate-100 font-mono text-[9px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
            {ticker.symbol.slice(0, 2).toUpperCase()}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
            {ticker.symbol}
            {weight != null && (
              <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
                {weight.toFixed(1)}%
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {ticker.quantity != null ? `${formatQty(ticker.quantity)} sh · ` : ""}
            {value != null ? `$${formatMoney(value)}` : ticker.name || profile.name || "—"}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {price != null ? `$${price.toFixed(2)}` : "…"}
          </span>
          <span className="block font-mono text-[11px] tabular-nums">
            <span className={dayPct == null ? "text-slate-400" : plColor(dayPct)}>
              {dayPct != null ? `${signed(dayPct, (v) => `${v.toFixed(2)}%`)}` : "—"}
            </span>
            {pl != null && (
              <span className={`ml-1.5 ${plColor(pl)}`}>
                {signed(pl, (v) => `$${formatMoney(v)}`)}
              </span>
            )}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="relative border-t border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-slate-800/70 dark:bg-slate-900/50">
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Detail label="Entry" value={ticker.entryPrice != null ? `$${ticker.entryPrice.toFixed(2)}` : "—"} />
            <Detail label="Qty" value={ticker.quantity != null ? formatQty(ticker.quantity) : "—"} />
            <Detail label="% port" value={weight != null ? `${weight.toFixed(1)}%` : "—"} />
            <Detail
              label="Day $"
              value={dayAbs != null ? signed(dayAbs, (v) => `$${formatMoney(v)}`) : "—"}
              tone={dayAbs != null ? plColor(dayAbs) : undefined}
            />
          </dl>
          {plPct != null && (
            <div className="mt-2 text-center font-mono text-[11px] text-slate-500 dark:text-slate-400">
              Total return {signed(plPct, (v) => `${v.toFixed(2)}%`)}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.push(`/position/${encodeURIComponent(ticker.symbol)}`)}
              className="inline-flex min-h-[44px] items-center font-mono text-[11px] font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-300"
            >
              Open position →
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex min-h-[44px] items-center font-mono text-[11px] font-medium text-red-600 dark:text-red-400"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 font-mono text-xs font-medium tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}
      >
        {value}
      </dd>
    </div>
  );
}
```

**Note on swipe-to-remove.** The spec calls for a swipe gesture. Remove lives in
the expanded panel for now, which is reachable, accessible and has a 44px target.
Swipe is added in Task 15 only if the browser pass shows the expanded-panel
placement is awkward — it is an enhancement, not a blocker, and a half-working
swipe is worse than a working button.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/mobile/HoldingRow.tsx
git commit -m "feat(mobile): add compact holding row

~56px against TickerCard's 171px, with day change added and % of portfolio
rendered as a tinted fill behind the row."
```

---

## Task 8: Sort chips and the holdings list

**Files:**
- Create: `components/mobile/SortChips.tsx`
- Create: `components/mobile/HoldingsList.tsx`

- [ ] **Step 1: Write the sort chips**

Create `components/mobile/SortChips.tsx`:

```tsx
"use client";

import { defaultDir, type SortColumn, type SortState } from "@/lib/holdings";

const MOBILE_COLUMNS: { column: SortColumn; label: string }[] = [
  { column: "value", label: "Value" },
  { column: "day", label: "Day" },
  { column: "pl", label: "P&L" },
  { column: "ticker", label: "Ticker" },
];

type Props = {
  sort: SortState | null;
  onChange: (next: SortState) => void;
};

export function SortChips({ sort, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Sort holdings"
      className="flex items-center gap-2 overflow-x-auto px-4 py-2"
    >
      {MOBILE_COLUMNS.map(({ column, label }) => {
        const active = sort?.column === column;
        return (
          <button
            key={column}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? {
                      column,
                      direction: sort.direction === "asc" ? "desc" : "asc",
                    }
                  : { column, direction: defaultDir(column) },
              )
            }
            className={`inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-md border px-3 font-mono text-[11px] font-medium uppercase tracking-wider transition-colors ${
              active
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            {label}
            {active && (
              <span aria-hidden className="text-[8px]">
                {sort.direction === "asc" ? "▲" : "▼"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write the list**

Create `components/mobile/HoldingsList.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { HoldingRow } from "./HoldingRow";
import { SortChips } from "./SortChips";
import { ConfirmModal } from "../ConfirmModal";
import {
  computeTotals,
  sortTickers,
  type Quotes,
  type SortState,
} from "@/lib/holdings";
import { getProfileNameSync } from "@/lib/profile";
import { formatMoney, plColor } from "@/lib/format";
import type { Ticker } from "@/types";

const SORT_STORAGE_KEY = "pp:mobile-sort:v1";

function readStoredSort(): SortState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SortState;
    return parsed?.column && parsed?.direction ? parsed : null;
  } catch {
    return null;
  }
}

type Props = {
  tickers: Ticker[];
  quotes: Quotes;
  onRemove: (symbol: string) => void;
};

export function HoldingsList({ tickers, quotes, onRemove }: Props) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setSort(readStoredSort()));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || sort == null) return;
    try {
      sessionStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
    } catch {
      // ignore
    }
  }, [sort]);

  const totals = useMemo(() => computeTotals(tickers, quotes), [tickers, quotes]);

  const sorted = useMemo(
    () =>
      sortTickers(tickers, sort, {
        quotes,
        totalValue: totals.marketValue,
        nameFor: getProfileNameSync,
      }),
    [tickers, sort, quotes, totals.marketValue],
  );

  const plPositive = totals.pl != null && totals.pl >= 0;
  const plPct =
    totals.pl != null && totals.costBasis > 0
      ? (totals.pl / totals.costBasis) * 100
      : null;

  return (
    <>
      <SortChips sort={sort} onChange={setSort} />

      <div className="border-t border-slate-200 dark:border-slate-800/70">
        {sorted.map((t) => (
          <HoldingRow
            key={t.symbol}
            ticker={t}
            quotes={quotes}
            totalValue={totals.marketValue}
            onRemove={() => setPendingRemoval(t.symbol)}
          />
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t-2 border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/60">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
          Total
        </span>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {totals.hasAnyValue ? `$${formatMoney(totals.marketValue)}` : "—"}
          </span>
          {totals.pl != null && (
            <span className={`font-mono text-[11px] tabular-nums ${plColor(totals.pl)}`}>
              {plPositive ? "+" : "−"}${formatMoney(Math.abs(totals.pl))}
              {plPct != null && (
                <span className="ml-1 opacity-80">
                  {plPositive ? "+" : "−"}
                  {Math.abs(plPct).toFixed(2)}%
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <ConfirmModal
        open={pendingRemoval != null}
        title="Remove position"
        body={
          <>
            Remove{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-900 dark:bg-slate-800 dark:text-slate-100">
              {pendingRemoval}
            </code>{" "}
            from this portfolio? You can add it back later.
          </>
        }
        confirmLabel="Remove"
        busyLabel="Removing…"
        destructive
        onConfirm={() => {
          if (pendingRemoval) onRemove(pendingRemoval);
          setPendingRemoval(null);
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </>
  );
}
```

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/mobile/SortChips.tsx components/mobile/HoldingsList.tsx
git commit -m "feat(mobile): add holdings list with sort chips

Mobile gains a sort control for the first time — the card list could never
reach the sort state, which lived only in the desktop table header."
```

---

## Task 9: Wire the mobile list in and delete TickerCard

After this task the app is usable on a phone. This is the first shippable point.

**Files:**
- Create: `hooks/useIsDesktop.ts`
- Modify: `components/WatchlistDashboard.tsx`
- Delete: `components/TickerCard.tsx`

- [ ] **Step 1: Write the breakpoint hook**

`hidden lg:block` still mounts both trees, which would run every fetch twice.
Branch in JS instead, using the same `useSyncExternalStore` idiom the codebase
uses for theme.

Create `hooks/useIsDesktop.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";

// Matches Tailwind's `lg` breakpoint.
const QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

// Mobile-first: the server renders the small layout, then the client corrects
// on hydration. Both trees are valid HTML, so this is a swap, not a mismatch.
function getServerSnapshot(): boolean {
  return false;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

- [ ] **Step 2: Update the dashboard imports**

In `components/WatchlistDashboard.tsx`, add:

```tsx
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useQuotes } from "@/hooks/useQuotes";
import { HoldingsList } from "./mobile/HoldingsList";
```

- [ ] **Step 3: Add the hooks to the component**

Immediately after the existing `useFinnhubPrices(symbols);` line, add:

```tsx
  const isDesktop = useIsDesktop();
  const quotes = useQuotes(symbols);
```

- [ ] **Step 4: Branch the content**

Replace the `{tickers.length > 0 ? ( ... ) : ( ... )}` block with:

```tsx
      {tickers.length > 0 ? (
        isDesktop ? (
          <>
            <SectorBreakdown tickers={tickers} />
            <RiskMetricsPanel tickers={tickers} />
            {view === "table" ? (
              <PortfolioTable
                tickers={tickers}
                onRemove={(symbol) => removeFromWatchlist(symbol)}
              />
            ) : (
              <PortfolioHeatmap tickers={tickers} />
            )}
          </>
        ) : (
          <HoldingsList
            tickers={tickers}
            quotes={quotes}
            onRemove={(symbol) => removeFromWatchlist(symbol)}
          />
        )
      ) : (
        <EmptyPortfolio
          ready={portfolioReady}
          onAddTicker={() => setAddOpen(true)}
        />
      )}
```

- [ ] **Step 5: Hide the desktop-only view toggle on mobile**

The Table/Heatmap toggle has no meaning on mobile, where the heatmap lives in
the sheet. In the header, wrap it:

```tsx
              {isDesktop && <ViewToggle view={view} onChange={setView} />}
```

- [ ] **Step 6: Delete TickerCard**

```bash
rm components/TickerCard.tsx
grep -rn "TickerCard" components app lib hooks
```

Expected: no output.

- [ ] **Step 7: Type check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no errors.

- [ ] **Step 8: Verify in the browser**

Run `npm run dev`, open `http://localhost:3000` in Chrome, open DevTools device
toolbar, choose iPhone 15 Pro (393×852), and load a portfolio with holdings.

Expected:
- At least three holdings visible without scrolling.
- Each row shows symbol, weight %, quantity, value, price, day %, and P&L.
- A tinted fill sits behind each row, widest on the largest position.
- Tapping a row expands entry/qty/% port/day $.
- Sort chips reorder the list; the choice survives a reload.
- Resizing past 1024px swaps to the desktop table.

- [ ] **Step 9: Commit**

```bash
git add hooks/useIsDesktop.ts components/WatchlistDashboard.tsx
git rm components/TickerCard.tsx
git commit -m "feat(mobile): render the compact holdings list below 1024px

Branches in JS rather than with hidden/lg:block so only one tree mounts and
data is not fetched twice. Deletes TickerCard."
```

---

## Task 10: The portfolio hero

**Files:**
- Create: `hooks/usePortfolioHistory.ts`
- Create: `components/mobile/PortfolioHero.tsx`
- Modify: `components/WatchlistDashboard.tsx`

- [ ] **Step 1: Write the history hook**

Create `hooks/usePortfolioHistory.ts`:

```ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PortfolioHistoryRange,
  PortfolioHistoryResponse,
  Ticker,
} from "@/types";

export type HistoryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: PortfolioHistoryResponse }
  | { kind: "error"; message: string };

/**
 * Keyed on the holdings shape and range only. A live price tick must never
 * trigger a refetch — same approach as RiskMetricsPanel's holdingsKey.
 */
function holdingsKey(holdings: { symbol: string; quantity: number }[]): string {
  return holdings
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((h) => `${h.symbol}:${h.quantity}`)
    .join("|");
}

export function usePortfolioHistory(
  tickers: Ticker[],
  range: PortfolioHistoryRange,
): HistoryState {
  const holdings = useMemo(
    () =>
      tickers
        .filter(
          (t): t is Ticker & { quantity: number } =>
            typeof t.quantity === "number" && t.quantity > 0,
        )
        .map((t) => ({ symbol: t.symbol, quantity: t.quantity })),
    [tickers],
  );

  const key = useMemo(() => holdingsKey(holdings), [holdings]);
  const [state, setState] = useState<HistoryState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (holdings.length === 0) {
      queueMicrotask(() => setState({ kind: "idle" }));
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    queueMicrotask(() => setState({ kind: "loading" }));

    (async () => {
      try {
        const res = await fetch("/api/portfolio-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: holdings, range }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `Request failed (${res.status})`);
        }
        setState({
          kind: "loaded",
          data: (await res.json()) as PortfolioHistoryResponse,
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load",
        });
      }
    })();

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return state;
}
```

- [ ] **Step 2: Write the hero**

Create `components/mobile/PortfolioHero.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { usePortfolioHistory } from "@/hooks/usePortfolioHistory";
import { computeTotals, type Quotes } from "@/lib/holdings";
import { formatMoney, plColor } from "@/lib/format";
import type { PortfolioHistoryRange, Ticker } from "@/types";

const RANGES: PortfolioHistoryRange[] = ["1D", "1M", "3M", "YTD", "1Y"];

type Props = {
  tickers: Ticker[];
  quotes: Quotes;
  portfolioName: string;
};

export function PortfolioHero({ tickers, quotes, portfolioName }: Props) {
  const [range, setRange] = useState<PortfolioHistoryRange>("1M");
  const history = usePortfolioHistory(tickers, range);
  const totals = useMemo(() => computeTotals(tickers, quotes), [tickers, quotes]);

  const points = history.kind === "loaded" ? history.data.points : [];
  const rising =
    points.length > 1 && points[points.length - 1].value >= points[0].value;
  const stroke = rising ? "#10b981" : "#ef4444";

  const dayPositive = totals.dayChange != null && totals.dayChange >= 0;
  const plPositive = totals.pl != null && totals.pl >= 0;

  return (
    <section className="px-4 pb-3 pt-1">
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
        {portfolioName}
      </div>
      <div className="mt-0.5 font-mono text-[28px] font-bold leading-none tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
        {totals.hasAnyValue ? `$${formatMoney(totals.marketValue)}` : "—"}
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        {totals.dayChange != null ? (
          <span className={plColor(totals.dayChange)}>
            {dayPositive ? "▲" : "▼"} {dayPositive ? "+" : "−"}$
            {formatMoney(Math.abs(totals.dayChange))}
            {totals.dayChangePct != null && (
              <span className="ml-1">
                {dayPositive ? "+" : "−"}
                {Math.abs(totals.dayChangePct).toFixed(2)}%
              </span>
            )}
            <span className="ml-1 text-slate-500">today</span>
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-600">— today</span>
        )}
        {totals.pl != null && (
          <span className={plColor(totals.pl)}>
            {plPositive ? "+" : "−"}${formatMoney(Math.abs(totals.pl))}
            <span className="ml-1 text-slate-500">all time</span>
          </span>
        )}
      </div>

      <div className="mt-2 h-[72px] w-full">
        {points.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pp-hero-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={1.75}
                fill="url(#pp-hero-fill)"
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center font-mono text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-600">
            {history.kind === "loading"
              ? "Loading history…"
              : history.kind === "error"
                ? "History unavailable"
                : "Add quantities to chart this portfolio"}
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border font-mono text-[11px] font-medium transition-colors ${
              range === r
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {history.kind === "loaded" && history.data.missing_symbols.length > 0 && (
        <p className="mt-2 font-mono text-[10px] text-slate-500">
          No history for {history.data.missing_symbols.join(", ")} — excluded.
        </p>
      )}
      {history.kind === "loaded" && points.length > 1 && (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-slate-400 dark:text-slate-600">
          {history.data.caveat}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Mount it**

In `components/WatchlistDashboard.tsx`, import it:

```tsx
import { PortfolioHero } from "./mobile/PortfolioHero";
```

and put it above `HoldingsList` in the mobile branch:

```tsx
          <>
            <PortfolioHero
              tickers={tickers}
              quotes={quotes}
              portfolioName={activePortfolioName ?? "Portfolio"}
            />
            <HoldingsList
              tickers={tickers}
              quotes={quotes}
              onRemove={(symbol) => removeFromWatchlist(symbol)}
            />
          </>
```

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Verify in the browser**

At 393px with holdings that have quantities:
- Total value, today's change and all-time P&L render immediately, before the
  chart arrives.
- The sparkline fills in, green when the period is up and red when down.
- Tapping 1D / 3M / YTD / 1Y refetches; the shape changes.
- With DevTools throttled to offline, the figures stay and the chart area shows
  "History unavailable" with no layout jump.

- [ ] **Step 6: Commit**

```bash
git add hooks/usePortfolioHistory.ts components/mobile/PortfolioHero.tsx components/WatchlistDashboard.tsx
git commit -m "feat(mobile): add portfolio hero with sparkline

Figures compute client-side from streaming prices so they never wait on the
chart request, which is keyed on holdings shape and range rather than ticks."
```

---

## Task 11: The analytics sheet shell

**Files:**
- Create: `components/mobile/AnalyticsSheet.tsx`
- Modify: `components/WatchlistDashboard.tsx`

- [ ] **Step 1: Write the shell**

Tabs are wired to placeholders here and filled in by Tasks 12-14, so the
interaction can be verified on its own.

Create `components/mobile/AnalyticsSheet.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";

export type SheetTab = "mix" | "risk" | "heatmap" | "ai";

const TABS: { id: SheetTab; label: string }[] = [
  { id: "mix", label: "Mix" },
  { id: "risk", label: "Risk" },
  { id: "heatmap", label: "Heatmap" },
  { id: "ai", label: "AI" },
];

type Props = {
  /** One-line summary shown while collapsed, e.g. the allocation bar. */
  peek: ReactNode;
  children: (tab: SheetTab) => ReactNode;
};

export function AnalyticsSheet({ peek, children }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SheetTab>("mix");

  return (
    <>
      {/* Spacer so the last holding is never trapped under the peek bar. */}
      <div aria-hidden className="h-[68px]" />

      {open && <SheetBackdrop onClose={() => setOpen(false)} />}

      <div
        className={`fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-slate-300 bg-white shadow-[0_-8px_32px_-12px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-out dark:border-slate-700 dark:bg-slate-900 ${
          open ? "max-h-[85vh]" : ""
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Collapse analytics" : "Expand analytics"}
          className="flex min-h-[56px] w-full flex-col items-stretch gap-2 px-4 pb-2 pt-2.5"
        >
          <span
            aria-hidden
            className="mx-auto h-1 w-9 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
          />
          {!open && peek}
        </button>

        {open && (
          <div className="max-h-[calc(85vh-56px)] overflow-y-auto px-4 pb-5">
            <div
              role="tablist"
              aria-label="Analytics"
              className="mb-3 flex gap-1.5"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border font-mono text-[11px] font-medium transition-colors ${
                    tab === t.id
                      ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {children(tab)}
          </div>
        )}
      </div>
    </>
  );
}

// Split out so useModalDismiss (Escape + body scroll-lock) only attaches while
// the sheet is open, matching how ModalShell uses it.
function SheetBackdrop({ onClose }: { onClose: () => void }) {
  useModalDismiss({ onClose });
  return (
    <button
      type="button"
      aria-label="Close analytics"
      tabIndex={-1}
      onClick={onClose}
      className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
    />
  );
}
```

- [ ] **Step 2: Mount it with placeholder tabs**

In `components/WatchlistDashboard.tsx`, import:

```tsx
import { AnalyticsSheet } from "./mobile/AnalyticsSheet";
```

and add it after `HoldingsList` inside the mobile branch:

```tsx
            <AnalyticsSheet
              peek={
                <span className="font-mono text-[11px] text-slate-500">
                  Analytics
                </span>
              }
            >
              {(tab) => (
                <div className="py-8 text-center font-mono text-xs text-slate-500">
                  {tab} tab
                </div>
              )}
            </AnalyticsSheet>
```

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify in the browser**

At 393px:
- A bar sits at the bottom of the viewport, above the home indicator.
- Tapping it expands the sheet over the list with a dimmed backdrop.
- Tab buttons switch the placeholder text.
- Backdrop tap and Escape both close it.
- The page behind does not scroll while it is open.
- The last holding is reachable when collapsed — not hidden under the bar.

- [ ] **Step 5: Commit**

```bash
git add components/mobile/AnalyticsSheet.tsx components/WatchlistDashboard.tsx
git commit -m "feat(mobile): add analytics sheet shell

Two states driven by tap and a CSS transform, no drag physics — the spec's
mitigation for scroll-vs-drag conflicts on iOS Safari."
```

---

## Task 12: The Mix tab

**Files:**
- Modify: `components/SectorBreakdown.tsx` (export two helpers)
- Create: `components/mobile/sheet/MixTab.tsx`
- Modify: `components/WatchlistDashboard.tsx`

- [ ] **Step 1: Export the sector helpers**

In `components/SectorBreakdown.tsx`, add `export` to the two functions the mobile
tab needs. Change:

```ts
function colorFor(sector: string, theme: Theme): string {
```

to:

```ts
export function colorFor(sector: string, theme: Theme): string {
```

and:

```ts
function computeSlices(tickers: Ticker[]): SectorSlice[] {
```

to:

```ts
export function computeSlices(tickers: Ticker[]): SectorSlice[] {
```

Nothing else in that file changes — the desktop donut keeps working.

- [ ] **Step 2: Write the tab**

Create `components/mobile/sheet/MixTab.tsx`:

```tsx
"use client";

import { useMemo, useSyncExternalStore } from "react";
import { colorFor, computeSlices } from "../../SectorBreakdown";
import { usePortfolioVersion } from "@/lib/finnhub";
import { useSectorsVersion } from "@/lib/sectors";
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
} from "@/lib/theme";
import { marketValue, type Quotes } from "@/lib/holdings";
import { formatCompactMoney } from "@/lib/format";
import type { Ticker } from "@/types";

const CONCENTRATION_THRESHOLD = 60;

type Props = { tickers: Ticker[]; quotes: Quotes };

export function MixTab({ tickers, quotes }: Props) {
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

  // Top-3 concentration, computed from holdings rather than sectors — it is a
  // different question from sector tilt and the one people get wrong.
  const concentration = useMemo(() => {
    const values = tickers
      .map((t) => marketValue(t, quotes))
      .filter((v): v is number => v != null && v > 0)
      .sort((a, b) => b - a);
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0 || values.length < 3) return null;
    const top3 = values.slice(0, 3).reduce((a, b) => a + b, 0);
    return (top3 / total) * 100;
  }, [tickers, quotes]);

  if (slices.length === 0) {
    return (
      <p className="py-8 text-center font-mono text-xs text-slate-500">
        Waiting for prices and sector data…
      </p>
    );
  }

  const total = slices.reduce((acc, s) => acc + s.value, 0);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Sector allocation
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-slate-500">
          {formatCompactMoney(total)}
        </span>
      </div>

      <div className="flex h-3.5 overflow-hidden rounded">
        {slices.map((s) => (
          <span
            key={s.sector}
            title={s.sector}
            style={{
              width: `${s.percent * 100}%`,
              backgroundColor: colorFor(s.sector, theme),
            }}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-col">
        {slices.map((s) => (
          <li
            key={s.sector}
            className="flex items-center gap-2.5 py-1.5 font-mono text-xs"
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
              {formatCompactMoney(s.value)}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-slate-900 dark:text-slate-100">
              {(s.percent * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>

      {concentration != null && concentration >= CONCENTRATION_THRESHOLD && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-800 dark:border-amber-500/30 dark:text-amber-200">
          Top 3 holdings are {concentration.toFixed(1)}% of the book.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the peek bar and wire the tab**

In `components/WatchlistDashboard.tsx`, add a small local component at the
bottom of the file:

```tsx
function SheetPeek({ tickers }: { tickers: Ticker[] }) {
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

  const top = slices[0];

  return (
    <span className="flex items-center gap-3">
      <span className="flex h-2.5 flex-1 overflow-hidden rounded">
        {slices.length > 0 ? (
          slices.map((s) => (
            <span
              key={s.sector}
              style={{
                width: `${s.percent * 100}%`,
                backgroundColor: colorFor(s.sector, theme),
              }}
            />
          ))
        ) : (
          <span className="w-full bg-slate-200 dark:bg-slate-700" />
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-slate-500">
        {top ? `${top.sector} ${(top.percent * 100).toFixed(0)}%` : "Analytics"}
      </span>
      <span aria-hidden className="shrink-0 text-slate-400">
        ▲
      </span>
    </span>
  );
}
```

Add the imports it needs:

```tsx
import { useSyncExternalStore } from "react"; // already imported — do not duplicate
import { usePortfolioVersion } from "@/lib/finnhub";
import { useSectorsVersion } from "@/lib/sectors";
import { getTheme, getThemeServerSnapshot, subscribeTheme } from "@/lib/theme";
import { colorFor, computeSlices } from "./SectorBreakdown";
import { MixTab } from "./mobile/sheet/MixTab";
import type { Ticker } from "@/types";
```

Then replace the sheet's props:

```tsx
            <AnalyticsSheet peek={<SheetPeek tickers={tickers} />}>
              {(tab) =>
                tab === "mix" ? (
                  <MixTab tickers={tickers} quotes={quotes} />
                ) : (
                  <div className="py-8 text-center font-mono text-xs text-slate-500">
                    {tab} tab
                  </div>
                )
              }
            </AnalyticsSheet>
```

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If lint reports a duplicate `useSyncExternalStore` import,
merge it into the existing `react` import line.

- [ ] **Step 5: Verify in the browser**

At 393px: the peek bar shows a coloured allocation strip and the largest sector.
Opening the sheet on Mix shows the stacked bar, the legend with dollar values and
percentages, and — if the top three holdings exceed 60% — the amber callout.

- [ ] **Step 6: Commit**

```bash
git add components/SectorBreakdown.tsx components/mobile/sheet/MixTab.tsx components/WatchlistDashboard.tsx
git commit -m "feat(mobile): add Mix tab and sheet peek bar

Stacked bar replaces the 350px donut and drops its duplicated total."
```

---

## Task 13: The Risk tab

**Files:**
- Create: `hooks/useRiskMetrics.ts`
- Create: `components/mobile/RiskGauge.tsx`
- Create: `components/mobile/sheet/RiskTab.tsx`
- Modify: `components/RiskMetricsPanel.tsx`
- Modify: `components/WatchlistDashboard.tsx`

- [ ] **Step 1: Extract the risk fetch**

Create `hooks/useRiskMetrics.ts`, moving the logic from
`RiskMetricsPanel.tsx:36-93` verbatim:

```ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// MUST stay `import type`. lib/mcp/risk.ts begins with `import "server-only"`,
// which throws at build time if it reaches a client bundle. A type-only import
// is erased by TypeScript, so nothing is emitted — but dropping the `type`
// keyword here will break the build.
import type { RiskResult } from "@/lib/mcp/risk";
import type { Ticker } from "@/types";

export type RiskState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: RiskResult }
  | { kind: "error"; message: string };

function holdingsKey(holdings: { symbol: string; quantity: number }[]): string {
  return holdings
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((h) => `${h.symbol}:${h.quantity}`)
    .join("|");
}

export function useRiskMetrics(tickers: Ticker[]): RiskState {
  const qualifying = useMemo(
    () =>
      tickers
        .filter(
          (t): t is Ticker & { quantity: number } =>
            typeof t.quantity === "number" && t.quantity > 0,
        )
        .map((t) => ({ symbol: t.symbol, quantity: t.quantity })),
    [tickers],
  );

  const key = useMemo(() => holdingsKey(qualifying), [qualifying]);
  const [state, setState] = useState<RiskState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (qualifying.length === 0) {
      queueMicrotask(() => setState({ kind: "idle" }));
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    queueMicrotask(() => setState({ kind: "loading" }));

    (async () => {
      try {
        const res = await fetch("/api/risk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: qualifying }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `Request failed (${res.status})`);
        }
        setState({ kind: "loaded", data: (await res.json()) as RiskResult });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load",
        });
      }
    })();

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return state;
}
```

- [ ] **Step 2: Rewire the desktop panel**

In `components/RiskMetricsPanel.tsx`:

- Delete the local `RiskResponse` type, `LoadState` type, `holdingsKey`, and the
  three `useEffect` blocks plus the `useState`/`useRef` that drive them.
- Replace them with:

```ts
import { useRiskMetrics, type RiskState } from "@/hooks/useRiskMetrics";
// Type-only, for the same reason as in the hook — see the note there.
import type { RiskResult } from "@/lib/mcp/risk";
```

```ts
export function RiskMetricsPanel({ tickers }: Props) {
  const state = useRiskMetrics(tickers);
  const hasQualifying = tickers.some(
    (t) => typeof t.quantity === "number" && t.quantity > 0,
  );
  if (!hasQualifying) return null;
```

- Rename every remaining `LoadState` to `RiskState` and every `RiskResponse` to
  `RiskResult`. The rest of the file — `Grid`, `Tile`, `RangeBadge`,
  `renderNumber`, `Skeleton`, `Em`, `InfoIcon` — is unchanged.

- [ ] **Step 3: Write the gauge**

Create `components/mobile/RiskGauge.tsx`:

```tsx
"use client";

import { useState } from "react";

export type GaugeZone = { upTo: number; className: string };

type Props = {
  label: string;
  /** Formatted value, or null when unknown. */
  display: string | null;
  /** Raw value used to position the marker. Null hides the marker. */
  value: number | null;
  min: number;
  max: number;
  zones: GaugeZone[];
  scaleLabels: [string, string, string];
  explanation: string;
  tone?: string;
  /** Optional reference line, e.g. beta 1.0 = "moves with the market". */
  tick?: number;
};

function markerPercent(value: number, min: number, max: number): number {
  const span = max - min;
  if (span === 0) return 0;
  return Math.min(100, Math.max(0, ((value - min) / span) * 100));
}

export function RiskGauge({
  label,
  display,
  value,
  min,
  max,
  zones,
  scaleLabels,
  explanation,
  tone,
  tick,
}: Props) {
  const [showExplanation, setShowExplanation] = useState(false);

  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowExplanation((v) => !v)}
          aria-expanded={showExplanation}
          className="inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400"
        >
          {label}
          <span
            aria-hidden
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[8px]"
          >
            i
          </span>
        </button>
        <span
          className={`font-mono text-base font-semibold tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}
        >
          {display ?? "—"}
        </span>
      </div>

      <div className="relative mt-1 flex h-1.5 overflow-hidden rounded-full">
        {zones.map((z, i) => {
          const from = i === 0 ? min : zones[i - 1].upTo;
          const width = ((z.upTo - from) / (max - min)) * 100;
          return (
            <span key={z.upTo} className={z.className} style={{ width: `${width}%` }} />
          );
        })}
        {tick != null && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-slate-500/70 dark:bg-slate-400/70"
            style={{ left: `${markerPercent(tick, min, max)}%` }}
          />
        )}
      </div>
      {value != null && (
        <div className="relative h-0">
          <span
            aria-hidden
            className="absolute -top-[9px] h-3 w-[3px] -translate-x-1/2 rounded-sm bg-slate-900 ring-2 ring-white dark:bg-white dark:ring-slate-900"
            style={{ left: `${markerPercent(value, min, max)}%` }}
          />
        </div>
      )}

      <div className="mt-2 flex justify-between font-mono text-[9px] text-slate-400 dark:text-slate-600">
        {scaleLabels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>

      {showExplanation && (
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
          {explanation}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the tab**

Create `components/mobile/sheet/RiskTab.tsx`:

```tsx
"use client";

import { RiskGauge } from "../RiskGauge";
import { useRiskMetrics } from "@/hooks/useRiskMetrics";
import type { Ticker } from "@/types";

const GOOD = "bg-emerald-500/70";
const MID = "bg-amber-500/70";
const BAD = "bg-red-500/70";
const NEUTRAL = "bg-slate-300 dark:bg-slate-700";

type Props = { tickers: Ticker[] };

export function RiskTab({ tickers }: Props) {
  const state = useRiskMetrics(tickers);

  if (state.kind === "idle") {
    return (
      <p className="py-8 text-center font-mono text-xs text-slate-500">
        Add quantities to your holdings to see risk metrics.
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="py-8 text-center font-mono text-xs text-slate-500">
        Couldn&apos;t compute risk metrics — {state.message}.
      </p>
    );
  }

  const d = state.kind === "loaded" ? state.data : null;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Risk · 1Y
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-slate-500">
          {d ? `${d.sample_days}d sample` : "…"}
        </span>
      </div>

      <RiskGauge
        label="Sharpe"
        value={d?.sharpe ?? null}
        display={d?.sharpe != null ? d.sharpe.toFixed(2) : null}
        min={0}
        max={3}
        zones={[
          { upTo: 1, className: BAD },
          { upTo: 2, className: MID },
          { upTo: 3, className: GOOD },
        ]}
        scaleLabels={["0 poor", "1.5", "3 great"]}
        tone={
          d?.sharpe == null
            ? undefined
            : d.sharpe >= 1
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
        }
        explanation="Return per unit of risk, after a 4% baseline. Above 1 is good, above 2 is excellent."
      />

      <RiskGauge
        label="Beta vs SPY"
        value={d?.beta ?? null}
        display={d?.beta != null ? d.beta.toFixed(2) : null}
        min={0}
        max={2}
        zones={[{ upTo: 2, className: NEUTRAL }]}
        tick={1}
        scaleLabels={["0 defensive", "1.0 market", "2 punchy"]}
        explanation="Sensitivity to S&P 500 moves. 1 means you move with the market. Higher is not worse — it is a choice about how much market exposure you want."
      />

      <RiskGauge
        label="Volatility"
        value={d?.volatility != null ? d.volatility * 100 : null}
        display={d?.volatility != null ? `${(d.volatility * 100).toFixed(1)}%` : null}
        min={0}
        max={40}
        zones={[
          { upTo: 15, className: GOOD },
          { upTo: 25, className: MID },
          { upTo: 40, className: BAD },
        ]}
        scaleLabels={["0% steady", "20%", "40% wild"]}
        explanation="Annualised standard deviation of daily returns. The bands assume a growth-heavy book — 20% is ordinary for tech and high for a bond-tilted portfolio."
      />

      <RiskGauge
        label="Max drawdown"
        value={d?.max_drawdown != null ? Math.abs(d.max_drawdown * 100) : null}
        display={d?.max_drawdown != null ? `${(d.max_drawdown * 100).toFixed(1)}%` : null}
        min={0}
        max={50}
        zones={[
          { upTo: 10, className: GOOD },
          { upTo: 20, className: MID },
          { upTo: 50, className: BAD },
        ]}
        scaleLabels={["0% mild", "-20%", "-50% brutal"]}
        tone={
          d?.max_drawdown == null ? undefined : "text-red-600 dark:text-red-400"
        }
        explanation="Worst peak-to-trough drop over the past year — the 'how bad did it actually get' number."
      />

      {d && d.missing_symbols && d.missing_symbols.length > 0 && (
        <p className="mt-3 font-mono text-[10px] text-slate-500">
          No history for {d.missing_symbols.join(", ")} — excluded.
        </p>
      )}
      {d && d.sample_days < 30 && (
        <p className="mt-2 font-mono text-[10px] text-slate-500">
          Only {d.sample_days} days of history — these are provisional.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire it into the sheet**

In `components/WatchlistDashboard.tsx`, import `RiskTab` and extend the switch:

```tsx
                tab === "mix" ? (
                  <MixTab tickers={tickers} quotes={quotes} />
                ) : tab === "risk" ? (
                  <RiskTab tickers={tickers} />
                ) : (
```

- [ ] **Step 6: Type check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no errors.

- [ ] **Step 7: Verify in the browser**

At 393px, open the sheet on Risk: four gauges render with coloured bands and a
marker. Tapping a label expands its explanation. At ≥1024px the desktop
`RiskMetricsPanel` still renders the old tiles with identical numbers.

- [ ] **Step 8: Commit**

```bash
git add hooks/useRiskMetrics.ts components/mobile/RiskGauge.tsx components/mobile/sheet/RiskTab.tsx components/RiskMetricsPanel.tsx components/WatchlistDashboard.tsx
git commit -m "feat(mobile): add Risk tab with zone gauges

Replaces title= tooltips, which do nothing on touch, with tap-to-expand
explanations, and gives each metric a scale so the number means something."
```

---

## Task 14: The Heatmap and AI tabs

**Files:**
- Modify: `components/PortfolioHeatmap.tsx`
- Create: `components/mobile/sheet/HeatmapTab.tsx`
- Create: `components/mobile/sheet/InsightsTab.tsx`
- Modify: `components/WatchlistDashboard.tsx`

- [ ] **Step 1: Fold tiny tiles in the heatmap**

In `components/PortfolioHeatmap.tsx`, add a `maxTiles` prop so the mobile tab can
cap the tile count, and give `buildTiles` an aggregation step.

Change the `Props` type:

```ts
type Props = {
  tickers: Ticker[];
  /** Beyond this, the smallest holdings collapse into one "+N smaller" tile. */
  maxTiles?: number;
};
```

Add below `buildTiles`:

```ts
/**
 * Collapse the tail into a single tile. Below ~56px wide a tile renders with no
 * label at all, so on a phone the smallest holdings are indistinguishable
 * rectangles. One labelled aggregate beats six blank ones.
 */
function foldSmallTiles(tiles: HeatTile[], maxTiles: number): HeatTile[] {
  if (tiles.length <= maxTiles) return tiles;
  const kept = tiles.slice(0, maxTiles - 1);
  const rest = tiles.slice(maxTiles - 1);
  const size = rest.reduce((acc, t) => acc + t.size, 0);
  const percent = rest.reduce((acc, t) => acc + t.percent, 0);
  return [
    ...kept,
    {
      symbol: `+${rest.length} smaller`,
      name: rest.map((t) => t.symbol).join(", "),
      size,
      percent,
      price: 0,
      dailyPct: null,
    },
  ];
}
```

In the component, accept and apply it:

```tsx
export function PortfolioHeatmap({ tickers, maxTiles }: Props) {
```

```tsx
  const tiles = useMemo(
    () => {
      const built = buildTiles(tickers);
      return maxTiles ? foldSmallTiles(built, maxTiles) : built;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickers, priceVersion, closeVersion, maxTiles],
  );
```

Guard navigation so the aggregate tile is not clickable — in the `content`
callback, change the select handler to:

```tsx
                (s) => {
                  if (s.startsWith("+")) return;
                  router.push(`/position/${encodeURIComponent(s)}`);
                },
```

- [ ] **Step 1b: Migrate the heatmap onto `useQuotes`**

Surfaced by the Task 2 review: `components/PortfolioHeatmap.tsx:195-208` is `useQuotes`
written out by hand — symbols memo, then `usePortfolioVersion` + `useDailyCloseVersion`,
then a memo over `getPriceSync`/`getDailyCloseSync` with the same `exhaustive-deps`
disable. Since this task already opens the file, replace that block with the shared hook
and drop the now-unused imports. `buildTiles` keeps reading prices the same way — pass
`quotes` into it rather than having it call the sync getters.

- [ ] **Step 2: Write the heatmap tab**

Create `components/mobile/sheet/HeatmapTab.tsx`:

```tsx
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
```

- [ ] **Step 3: Write the insights tab**

`useInsights` and `SectionCard` already exist and are independent of the drawer
shell, so the tab consumes them directly.

Create `components/mobile/sheet/InsightsTab.tsx`:

```tsx
"use client";

import { SECTION_KEYS } from "../../insights/stream";
import { useInsights } from "../../insights/useInsights";
import { SectionCard } from "../../insights/SectionCard";
import type { Ticker } from "@/types";

type Props = {
  tickers: Ticker[];
  portfolioName: string;
  portfolioId: string | null;
};

export function InsightsTab({ tickers, portfolioName, portfolioId }: Props) {
  const { loading, sections, activeKey, error, regenerate } = useInsights({
    open: true,
    tickers,
    portfolioName,
    portfolioId,
  });

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          AI insights
        </h3>
        <button
          type="button"
          onClick={regenerate}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center font-mono text-[11px] font-medium text-slate-600 disabled:opacity-50 dark:text-slate-400"
        >
          {loading ? "Thinking…" : "Regenerate"}
        </button>
      </div>

      {error && (
        <p className="mb-3 font-mono text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {SECTION_KEYS.map((key) => (
        <SectionCard
          key={key}
          sectionKey={key}
          body={sections[key]}
          active={loading && activeKey === key}
          loading={loading}
        />
      ))}
    </div>
  );
}
```

`SectionCard`'s props are `{ sectionKey, body, active, loading }` and
`useInsights` returns `{ loading, sections, activeKey, generatedAt, error, regenerate }`
— both verified against the current source. Do not modify either file;
`InsightsDrawer` still uses them on the desktop path.

- [ ] **Step 4: Wire both tabs**

In `components/WatchlistDashboard.tsx`, import them and complete the switch:

```tsx
              {(tab) =>
                tab === "mix" ? (
                  <MixTab tickers={tickers} quotes={quotes} />
                ) : tab === "risk" ? (
                  <RiskTab tickers={tickers} />
                ) : tab === "heatmap" ? (
                  <HeatmapTab tickers={tickers} />
                ) : (
                  <InsightsTab
                    tickers={tickers}
                    portfolioName={activePortfolioName ?? "Portfolio"}
                    portfolioId={activeId ?? null}
                  />
                )
              }
```

- [ ] **Step 5: Drop the mobile-only Insights header button**

The AI tab replaces it below `lg`. In the header, change the Insights button to
render only on desktop:

```tsx
              {isDesktop && (
                <button
                  onClick={() => setInsightsOpen(true)}
                  ...
              )}
```

Keep `InsightsDrawer` mounted for the desktop path.

- [ ] **Step 6: Type check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no errors.

- [ ] **Step 7: Verify in the browser**

At 393px with 10+ holdings: the Heatmap tab shows at most 8 tiles, all labelled,
with the tail folded into "+N smaller"; tapping a real tile navigates, tapping
the aggregate does nothing. The AI tab streams insights and Regenerate works.

- [ ] **Step 8: Commit**

```bash
git add components/PortfolioHeatmap.tsx components/mobile/sheet/HeatmapTab.tsx components/mobile/sheet/InsightsTab.tsx components/WatchlistDashboard.tsx
git commit -m "feat(mobile): add Heatmap and AI tabs

Folds sub-label-size heatmap tiles into one aggregate so nothing renders as
an unidentifiable blank rectangle at phone width."
```

---

## Task 15: Platform polish

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `components/WatchlistDashboard.tsx`

- [ ] **Step 1: Add the viewport export**

In `app/layout.tsx`, add to the imports:

```ts
import type { Metadata, Viewport } from "next";
```

and export below `metadata`:

```ts
// Matches --bg-base in globals.css so iOS Safari's chrome blends with the page
// instead of framing it in white.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e1a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

- [ ] **Step 2: Add safe-area padding to the footer**

In `app/layout.tsx`, give the footer bottom safe-area room so it clears the home
indicator:

```tsx
        <footer
          className="mt-auto border-t border-slate-200/80 px-4 py-4 dark:border-slate-800/70 sm:px-6"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
```

- [ ] **Step 3: Guard the flash animations and drop the fixed background**

Append to `app/globals.css`:

```css
/* iOS Safari repaints a fixed background on every scroll frame. The gradient is
   decoration; below the desktop breakpoint it is not worth the jank. */
@media (max-width: 1023px) {
  body {
    background-attachment: scroll;
  }
}

/* With 25 symbols streaming, a full-list flash is a strobe. */
@media (prefers-reduced-motion: reduce) {
  .flash-up,
  .flash-down,
  .flash-up-row,
  .flash-down-row {
    animation: none;
  }
}
```

- [ ] **Step 4: Add home-screen install assets**

Create `app/manifest.ts` (Next generates `/manifest.webmanifest` from it):

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Port Pulse",
    short_name: "Port Pulse",
    description:
      "Live tracker for your investment portfolio — upload a screenshot, watch the prices.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e1a",
    theme_color: "#0a0e1a",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
```

Add two PNGs to `app/`, which Next serves as the icons above:
- `app/icon.png` — 512×512
- `app/apple-icon.png` — 180×180

Both should be the Port Pulse mark on the `#0a0e1a` background. If no mark
exists yet, render "PP" in JetBrains Mono, white on `#0a0e1a`, and note in the
commit that it is a placeholder. Do **not** skip the files — a manifest that
references missing icons is worse than no manifest.

- [ ] **Step 5: Move the Finnhub cap banner below the hero**

In `components/WatchlistDashboard.tsx`, the `overCap` banner currently renders
above the content and pushes the hero down. Move its JSX so it renders *after*
`PortfolioHero` inside the mobile branch, and leave the desktop path as it is.

- [ ] **Step 6: Enlarge the remaining sub-44px header targets**

In `components/WatchlistDashboard.tsx`, the header icon buttons use
`h-[30px]`/`w-[30px]`. On the mobile path change these to `min-h-[44px]` and
`min-w-[44px]`. The `ViewToggle` is already desktop-only after Task 9, so it
needs no change.

- [ ] **Step 7: Type check, lint and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors. The build is included here because `app/manifest.ts` and
the icon conventions are only exercised at build time.

- [ ] **Step 8: Commit**

```bash
git add app/layout.tsx app/globals.css app/manifest.ts app/icon.png app/apple-icon.png components/WatchlistDashboard.tsx
git commit -m "fix(mobile): viewport, safe areas, reduced motion, tap targets, manifest"
```

---

## Task 16: Full verification pass

No code unless something fails. Use the `verify` skill.

- [ ] **Step 1: Run everything**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

Expected: all pass, build succeeds.

- [ ] **Step 2: Check every width**

With `npm run dev` and DevTools device toolbar, load a portfolio at each of:

| Width | Device | Expect |
|---|---|---|
| 393px | iPhone 15 Pro | Mobile layout; ≥3 holdings above the fold |
| 430px | iPhone 15 Pro Max | Mobile layout, no clipping |
| 820px | iPad portrait | Mobile layout, roomier, no stretched rows |
| 1180px | iPad landscape | Desktop table |
| 1440px | Laptop | Desktop table, visually identical to `main` |

- [ ] **Step 3: Check the headline goal**

At 393px with 10 holdings, reload. Count the holdings visible without scrolling.
Expected: at least 3. If 0, the redesign has failed its purpose — stop and
report rather than continuing.

- [ ] **Step 4: Check both auth states**

Signed out (sessionStorage watchlist): hero figures, sparkline, all four tabs
work. Signed in: the same, plus the portfolio selector.

- [ ] **Step 5: Check both themes and reduced motion**

Toggle light/dark — no unreadable text, gauge zones legible in both. Enable
"Emulate prefers-reduced-motion" in DevTools Rendering — price updates change
colour without flashing.

- [ ] **Step 6: Check degradation**

Throttle to offline in DevTools, then reload. Expected: hero figures still
render from cached prices where available, chart shows "History unavailable",
Risk tab shows its error, the list still renders, nothing blanks out.

- [ ] **Step 7: Report**

Write up what was verified and anything that did not work. Two things to
explicitly decide now that they can be seen with real data:

1. **The weight fill colour** — does day-direction tinting read as useful or as
   noise? If noise, change both branches of `fillClass` in `HoldingRow.tsx` to
   `bg-slate-400/10 dark:bg-slate-500/10` and commit that.
2. **Swipe-to-remove** — is Remove-in-the-expanded-panel awkward enough to
   justify a swipe gesture? If yes, it is a follow-up task, not a patch here.

- [ ] **Step 8: Commit any fixes and push**

```bash
git push -u origin feat/mobile-redesign
```

---

## Deviations from the spec

One, recorded deliberately rather than silently:

**Heatmap tap behaviour.** The spec says the hover tooltip becomes
"tap-to-select with a detail line". This plan keeps the existing Recharts
tooltip and keeps tap navigating to the position page, because the treemap
already has that handler and a two-stage tap (select, then read, then navigate)
is worse on a phone than going straight there. The label problem the spec
actually cared about — blank unlabelled tiles — is fixed by the `+N smaller`
folding in Task 14. If the browser pass in Task 16 shows the tooltip is
unreachable on touch, add a detail line then.

## Follow-ups (not in this plan)

- `/position/[symbol]` mobile pass — explicitly out of scope in the spec.
- **`components/TickerTableRow.tsx:27-32` re-derives holdings maths inline** — market
  value, cost basis, unrealized P&L and portfolio weight, duplicating `marketValue`,
  `costBasis`, `unrealizedPl` and `weightPct` from `lib/holdings.ts`. Surfaced by the
  Task 2 review. Deliberately not migrated: it is desktop-only code and "no desktop
  changes" is a stated non-goal. Worth doing, because it is a live divergence risk
  against the shared module — but as its own change, not smuggled into this plan.
- Per-row sparklines (rejected as R2, but the expanded row already charts).
- Swipe-to-remove, if Task 16 step 7 shows it is needed.
- 5Y on the hero, if the range chips turn out to have room.
