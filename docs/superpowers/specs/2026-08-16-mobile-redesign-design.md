# Port Pulse Mobile Dashboard — Design

**Date:** 2026-08-16
**Status:** Approved, pending implementation plan

## Goal

Make the dashboard genuinely usable on a phone. The owner checks this app on an
iPhone first, an iPad second, and a laptop rarely — but the dashboard below
640px is a stack of full-width chart sections followed by 171px cards, so on a
390×844 screen **no holding is visible on landing**.

Two outcomes:

1. Your positions and today's move are on screen the instant the page loads.
2. The charts get better, not fewer — richer than today, but out of the way
   until you want them.

## Non-goals

- **No desktop changes.** At ≥1024px the current table renders exactly as it
  does today.
- **No changes to `/compare`.** Its layout, ranges, and API stay as they are.
- **No mobile pass on `/position/[symbol]`.** It is a separate screen with its
  own audit. Natural next round; explicitly deferred.
- **No new data sources.** Everything comes from Finnhub (already streaming),
  Yahoo via `lib/yahoo.ts` (already used), or existing routes.
- **No writes and no schema changes.** This is presentation only.
- **No sheet physics.** No velocity tracking, no free-form drag. See Risks.

## Background

### Measured state at 390×844

Values read from the current Tailwind classes, not estimated:

| Block | Height | Source |
|---|---|---|
| Navbar (sticky) | 56px | `Navbar.tsx:15` `h-14` |
| Header row | ~62px | `WatchlistDashboard.tsx:106` |
| `SectorBreakdown` | ~350px | 180px donut **stacked above** legend (`SectorBreakdown.tsx:158-159`) |
| `RiskMetricsPanel` | ~176px | 2×2 tile grid (`RiskMetricsPanel.tsx:178`) |
| **Chrome before holding #1** | **~590px** | |
| Each `TickerCard` | **~171px** | 36px logo row + 98px 2×2 `DataTile` grid + padding |

Usable viewport after Safari chrome is ~700px. Ten holdings is ~2,300px of
scroll, and at most four are ever on screen together.

### Defects the redesign must fix

1. **`TickerCard`'s 2×2 grid** (`TickerCard.tsx:123-141`) spends ~98px on Value,
   % of port, Qty, Entry. Qty and Entry are static reference data — they never
   change and are one tap from the position page.
2. **Day change is missing everywhere.** The card shows P&L since entry but not
   today's move, which is the number a live tracker exists for. The data is
   already fetched: `getDailyCloseSync` (`lib/dailyClose.ts`) holds prev close,
   but only `PortfolioHeatmap` subscribes.
3. **Risk tooltips are inert on touch.** `RiskMetricsPanel.tsx:211` uses
   `title={tooltip}`, which has no touch equivalent. On a phone the ⓘ is
   decorative: you get "Sharpe 1.42" with no way to learn what it means or
   whether it is good.
4. **Sorting is desktop-only.** `sort` state lives in `PortfolioTable` but only
   `<thead>` can set it (`PortfolioTable.tsx:214-237`). The mobile branch renders
   `sortedTickers` with no control. You cannot sort by P&L, value, or day change
   on a phone. This is a functional gap, not a cosmetic one.
5. **No portfolio-level chart on the dashboard.** `/api/compare` and
   `CompareChart` exist, but the main screen has zero trend visualisation.
6. **Sector donut is the wrong form factor.** 350px to convey "you're 61% tech",
   and its centre label repeats the section header total and the table footer
   total — the same number three times.
7. **Heatmap tiles render blank.** `renderTile` hides the symbol below 56px wide
   or 36px tall (`PortfolioHeatmap.tsx:150`). At 390px with 10+ holdings most
   tiles are unlabelled, identifiable only by a hover tooltip.
8. **Tap targets below 44px.** ViewToggle ~26px (`WatchlistDashboard.tsx:239`),
   header icon buttons 30px, `TickerCard` remove ~24px sitting on top of a
   element that is itself a link.
9. **Header wraps.** Six controls in a `flex-wrap` row
   (`WatchlistDashboard.tsx:106`) break to two lines with any non-trivial
   portfolio name.
10. **Platform gaps.** No `viewport` export or `themeColor` in `layout.tsx`, so
    iOS Safari chrome does not match the dark background. No safe-area insets, no
    manifest or apple-touch-icon. `background-attachment: fixed`
    (`globals.css:42`) is a known iOS Safari scroll-jank source. No
    `prefers-reduced-motion` guard on the flash keyframes, so 25 streaming
    symbols strobe the screen.

### Reusable machinery already present

- `lib/finnhub.ts` — `useFinnhubPrices`, `getPriceSync`, `usePortfolioVersion`.
- `lib/dailyClose.ts` — `getDailyCloseSync`, `useDailyCloseVersion`.
- `app/api/risk/route.ts` — **unauthenticated** `POST {tickers:[{symbol,quantity}]}`.
  Establishes the "post holdings, get a computed result" pattern that works in
  both auth states.
- `app/api/compare/route.ts` — `computePortfolioValues()` (lines 256-287)
  implements snap-to-prior portfolio valuation across a union of timestamps.
- `lib/yahoo.ts` — `fetchYahooChart(symbol, range, intervalOverride?)`.
- `lib/sectors.ts` — `getSectorSync`, `useSectorsVersion`.

### Why `/api/compare` cannot back the hero chart

Three blockers, all in `app/api/compare/route.ts`:

- Returns 401 without a Supabase session (line 71), so signed-out users get no
  chart.
- Takes portfolio **IDs** and reads holdings from Supabase (lines 100-108), so it
  cannot value a `sessionStorage` watchlist.
- `COMPARE_RANGES` excludes `1D` (`lib/compare.ts:26`) and the route rejects
  anything outside it (line 46). The shortest window would be 1M, on the screen
  you open to check today.

## Decisions

Validated against rendered mockups in `.superpowers/brainstorm/` before approval.

| # | Decision | Chosen |
|---|---|---|
| 1 | Information architecture | **Hero + list always visible; analytics in a bottom sheet** |
| 2 | Holding row | **Compact 2-line row + weight-as-background** |
| 3 | Risk presentation | **Zone gauges with a marker** |
| 4 | Tablet | **Same layout up to 1024px, roomier** |
| 5 | Hero chart data | **New `POST /api/portfolio-history`** |

Rejected, with reasons worth keeping:

- **Tabbed sections** (Overview / Holdings / Mix / Risk) — a better study
  surface, but it puts positions one tap away on a screen opened for a glance.
- **Sparkline in every row** — forces the right side down to one metric and adds
  N history requests per load. Deferred, not dead: the expanded row already
  carries a chart, so sparklines can be added later without rework.
- **Radar chart for risk** — forces four different units onto one geometry, and
  with only four axes reads as decorative.

## Architecture

The layout split moves from `sm` (640px) to `lg` (1024px).

- **< 1024px** — hero + list + sheet. iPhone and both iPad orientations.
- **≥ 1024px** — today's `PortfolioTable`, unchanged.

One new layout, not two. iPad gets the same single column with more generous
spacing rather than a bespoke two-pane treatment.

```
WatchlistDashboard
├── PortfolioHero          value · day change · total P&L · sparkline · range chips
├── HoldingsList           sort chips → HoldingRow[] → total footer
│   └── HoldingRow         identity, 4 numbers, weight fill
│       └── (expanded)     entry · qty · % port · day $ + range chart
└── AnalyticsSheet         peek ⇄ expanded
    ├── MixTab             stacked bar + legend + concentration callout
    ├── RiskTab            zone gauges
    ├── HeatmapTab         existing treemap + "+N smaller" folding
    └── InsightsTab        existing insights content, drawer shell dropped
```

### `PortfolioHero`

Total market value, today's change (absolute and percent), total P&L, an area
sparkline, and range chips `1D · 1M · 3M · YTD · 1Y`. 5Y stays on `/compare`,
where the chips have room.

Value, day change and P&L are computed client-side from data already streaming,
so they render immediately and never depend on the chart request.

The chart request is keyed on `(holdings shape, range)` and **not** on price
ticks, using the same stable-key approach as `RiskMetricsPanel`'s `holdingsKey`
(`RiskMetricsPanel.tsx:27-34`). A live price update must never trigger a refetch;
only adding, removing, or re-quantifying a holding, or changing the range, does.
In-flight requests abort on key change, as the risk panel already does.

### `HoldingRow`

~52px, two lines:

```
[logo] AAPL 30.2%              $234.56
       62 sh · $14,542   +1.24% · +$2,411
```

Behind the content sits an absolutely-positioned fill whose width is the
holding's percentage of portfolio market value, tinted by today's direction. A
chart at zero extra height: concentration is readable without opening anything.

- **Tap** expands in place — entry, qty, % of port, day $, and a range chart.
- **Swipe left** reveals Remove, retiring the 24px × button that currently sits
  on top of a link (`TickerCard.tsx:54-71`). Removal keeps the existing
  `ConfirmModal`.
- **Tap the symbol** opens `/position/[symbol]`.

`HoldingsList` carries the sort control the mobile layout has never had: a chip
row over `Value`, `Day`, `P&L`, and `Ticker`, each toggling direction on a second
tap. `Value`, `P&L` and `Ticker` map onto the existing `SortColumn` values
`value`, `pl` and `ticker`. **`Day` is a new column** — day change does not exist
in today's `SortColumn` union, so `lib/holdings.ts` adds `"day"` with a
`sortValue` branch returning `price − prevClose` over prev close, null when
either is unknown. `qty`, `entry`, `name` and `percent` stay desktop-only; weight
is already visible as the row fill. Sort state persists for the session alongside
the existing view preference in `sessionStorage`.

### `AnalyticsSheet`

Two states.

- **Peek** — a single ~44px line pinned above the fold: the sector allocation bar
  plus two headline figures (`Tech 61% · Sharpe 1.42`). This is the entire cost
  of the charts when you are not looking at them, versus ~526px today.
- **Expanded** — slides up over the list with a backdrop. Tabs: Mix, Risk,
  Heatmap, AI.

Opened by tapping the peek line or the grab handle; closed by the handle, the
backdrop, or Escape. Because it overlays the list rather than sitting in flow,
each tab gets close to full screen height — the charts end up **larger** than
they are inline today, not smaller.

**Mix** — full-width stacked bar, then a legend list (swatch, sector, $, %), then
a concentration callout ("Top 3 holdings are 70.7% of the book"). ~200px against
today's 350px, and it drops the triplicated total.

**Risk** — one gauge per metric: label with a tappable ⓘ, the value, a horizontal
scale with coloured zones, and a marker at your position. Tapping ⓘ expands the
plain-English explanation inline, replacing the dead `title` attribute.

Zone boundaries, recorded because they are judgement calls, not standards:

| Metric | Scale | Zones |
|---|---|---|
| Sharpe | 0 → 3 | <1 poor, 1–2 good, >2 great |
| Beta vs SPY | 0 → 2 | neutral track, tick at 1.0 |
| Volatility | 0% → 40% | <15% steady, 15–25% typical, >25% high |
| Max drawdown | 0% → −50% | >−10% mild, −10 to −20% meaningful, <−20% severe |

Beta gets no good/bad colouring — high beta is a choice, not a defect. The
volatility bands assume a tech-heavy book; the UI labels them
("typical", "high") rather than implying they are objective.

**Heatmap** — the existing `PortfolioHeatmap`, plus two fixes: tiles too small to
label are folded into one `+N smaller` tile so nothing renders blank, and the
hover tooltip becomes tap-to-select with a detail line, since hover does not
exist on touch.

**AI** — the existing insights content, with `InsightsDrawer`'s shell dropped on
mobile.

## Components

### New

| Path | Responsibility |
|---|---|
| `components/mobile/PortfolioHero.tsx` | Hero figures, sparkline, range chips |
| `components/mobile/HoldingsList.tsx` | Sort chips, rows, total footer |
| `components/mobile/HoldingRow.tsx` | One holding, collapsed and expanded |
| `components/mobile/AnalyticsSheet.tsx` | Peek/expanded shell, tabs, backdrop |
| `components/mobile/sheet/MixTab.tsx` | Stacked bar, legend, concentration callout |
| `components/mobile/sheet/RiskTab.tsx` | Gauge list |
| `components/mobile/RiskGauge.tsx` | One metric: label, value, zoned scale, marker |
| `lib/holdings.ts` | `computeTotals`, `sortTickers`, `sortValue`, day-change math |
| `lib/portfolioSeries.ts` | `computePortfolioValues`, extracted from the compare route |
| `hooks/useRiskMetrics.ts` | Risk fetch/abort, extracted from `RiskMetricsPanel` |
| `app/api/portfolio-history/route.ts` | New endpoint |

### Changed

| Path | Change |
|---|---|
| `components/PortfolioTable.tsx` | Desktop table only. Mobile branch (lines 169-206) removed; pure functions (lines 29-126) move to `lib/holdings.ts` |
| `components/TickerCard.tsx` | Deleted — replaced by `HoldingRow` |
| `components/WatchlistDashboard.tsx` | Renders hero/list/sheet below `lg`, table above; subscribes `useDailyCloseVersion`; header controls thinned |
| `components/RiskMetricsPanel.tsx` | Consumes `useRiskMetrics`; presentation otherwise unchanged |
| `components/SectorBreakdown.tsx` | `computeSlices` exported for `MixTab`; donut retained for desktop |
| `components/PortfolioHeatmap.tsx` | `+N smaller` folding; tap-to-select |
| `components/InsightsDrawer.tsx` | Content extracted so `InsightsTab` can host it |
| `app/api/compare/route.ts` | Imports `computePortfolioValues` instead of defining it |
| `app/layout.tsx` | `viewport` export: `themeColor`, `viewportFit: "cover"`; apple-touch-icon |
| `app/globals.css` | `prefers-reduced-motion` guard; drop `background-attachment: fixed` below `lg` |

### Why these refactors

`PortfolioTable.tsx` is 358 lines owning sorting, totals, the desktop table, the
mobile list, and a confirm modal. Its mobile half is being replaced regardless,
so splitting it is cheaper than growing it — and it moves `computeTotals` and
`sortTickers` somewhere they can be tested.

`useRiskMetrics` and `lib/portfolioSeries.ts` both exist to stop duplicate logic
from drifting, matching the reasoning already recorded in `app/api/risk/route.ts`
about `lib/mcp/risk.ts`.

## Data flow

| Need | Source | New? |
|---|---|---|
| Live price | `useFinnhubPrices` / `getPriceSync` | no |
| Day change | `getDailyCloseSync` × quantity, client-side | no — but `useDailyCloseVersion` moves up to the dashboard |
| Hero sparkline | `POST /api/portfolio-history` | **yes** |
| Risk gauges | `POST /api/risk` via `useRiskMetrics` | no |
| Sector mix | `lib/sectors.ts` | no |
| AI insights | `/api/insights` stream | no |

Day change needs no request at all:
`dayChange = Σ quantity × (price − prevClose)` over holdings where both are
known. Prev close already arrives from the Finnhub quote endpoint.

### `POST /api/portfolio-history`

Mirrors `app/api/risk/route.ts` deliberately — same shape, same validation, same
public access.

**Request**

```json
{ "tickers": [{ "symbol": "AAPL", "quantity": 62 }], "range": "1M" }
```

**Response**

```json
{
  "range": "1M",
  "points": [{ "time": 1767225600, "value": 47102.4 }],
  "startValue": 47102.4,
  "endValue": 48214.6,
  "missing_symbols": [],
  "caveat": "Portfolio history reflects your current holdings throughout the period. Past buys and sells aren't accounted for."
}
```

- Validation reuses `/api/risk`'s rules: `SYMBOL_RE`, positive finite quantity,
  `MAX_TICKERS` 60, 400 on an empty holding set.
- Ranges: `1D`, `1M`, `3M`, `YTD`, `1Y`. 400 otherwise.
- Fetches each unique symbol via `fetchYahooChart`, then values the portfolio
  with the shared `computePortfolioValues`, aligning to the latest start date
  across symbols exactly as `/api/compare` does.
- Symbols with no history land in `missing_symbols` and are excluded, matching
  `RiskMetricsPanel`'s existing disclosure pattern.
- No authentication, so a signed-out `sessionStorage` watchlist charts normally.
- `Cache-Control: private, max-age=0, no-store`, as `/api/risk` uses.

The caveat is surfaced under the chart. The series values *current* holdings
backwards through time; it is not a record of what the account was actually
worth.

## Error handling

Every block degrades on its own — one failure never blanks the screen.

| Failure | Behaviour |
|---|---|
| History request fails or returns no points | Hero keeps value, day change, P&L (all client-side). Chart area collapses to a one-line "History unavailable" — no broken box, no layout jump |
| Some symbols lack history | Chart renders from the rest; `missing_symbols` noted under it |
| Risk request fails | Gauges render grey, no marker, `—` value. Preserves today's behaviour |
| Holding has no quantity | Row shows price and day % only; value, P&L and weight fill absent |
| Prices not yet streaming | Existing skeletons; hero shows `—` until the first tick |
| Sector data unavailable | Mix tab shows a single "Unclassified" band; peek line drops the sector figure |
| Over 25 symbols | Existing amber Finnhub-cap banner, relocated below the hero so it cannot push it off screen |
| Insights fails | AI tab shows its error; other tabs unaffected |

## Risks

**The sheet gesture.** Free-form drag layered over a scrolling list is where this
kind of UI usually breaks on iOS Safari — scroll and drag fight for the same
touch. Mitigation is to build a **two-state** sheet driven by tap plus a CSS
transform, with no velocity tracking or intermediate detents. Nearly all the
value, far less to go wrong. Recorded because the approved mockup showed a grab
handle, which implies draggability.

**The weight fill colour.** Tinting by day direction means a red day tints the
whole list red. That may read as portfolio mood or as noise, and it cannot be
settled from a mockup. Fallback is a neutral slate fill at the same opacity. To
be decided in a browser against real holdings, during implementation.

**The peek line costs ~44px** permanently above the fold. Accepted, but it is not
free.

**Deleting `TickerCard`** is a one-way step for the mobile presentation. Its
useful parts — logo/initial badge, flash class, P&L formatting — carry over to
`HoldingRow`.

## Verification

Automated (Vitest, existing setup):

- `lib/holdings.ts` — totals with mixed missing quantities and entry prices;
  sorting with nulls last in both directions; weight percentages summing to 100;
  day-change math when prev close is absent.
- `lib/portfolioSeries.ts` — snap-to-prior valuation; alignment to the latest
  start across symbols; a symbol with no overlapping history; empty input.
- `app/api/portfolio-history` — symbol sanitisation, quantity rejection, the
  60-ticker cap, invalid range, empty holdings, following the patterns in
  `lib/mcp/*.test.ts`.

Manual, via the `verify` skill, before the work is called done:

- 390px (iPhone), 430px (iPhone Pro Max), 820px (iPad portrait), 1180px (iPad
  landscape), and ≥1024px to confirm desktop is untouched.
- At least one holding above the fold on landing at 390px — the headline goal.
- Sheet open/close, tab switching, scroll behind the backdrop.
- Row expand, collapse, swipe-to-remove, navigation to the position page.
- Both themes; `prefers-reduced-motion` on and off.
- Signed out (sessionStorage) and signed in, since the hero chart must work in
  both.

## Build order

1. `lib/holdings.ts` + tests; `PortfolioTable` split so desktop keeps working.
2. `lib/portfolioSeries.ts` extracted from `/api/compare` + tests; compare route
   updated and confirmed unchanged in behaviour.
3. `POST /api/portfolio-history` + tests.
4. `HoldingRow` and `HoldingsList`, including mobile sort chips — the fix that
   makes the screen usable on its own.
5. `PortfolioHero`, client-side figures first, then the sparkline.
6. `AnalyticsSheet` shell with the peek line.
7. Tabs: Mix, Risk (with `useRiskMetrics` extracted), Heatmap, AI.
8. Platform fixes — viewport/themeColor, safe areas, 44px targets, reduced
   motion, background-attachment, apple-touch-icon.
9. Verification pass at every width.

Steps 1-4 are independently shippable and deliver most of the density win.
