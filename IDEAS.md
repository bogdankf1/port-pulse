# Port Pulse — Ideas Backlog

> A running dump of improvement ideas, refined and documented for later implementation.
> Nothing here is being built yet — this is the capture stage. Items are numbered in the
> order they were raised. Each item notes the type, the intent, what's needed, affected
> areas, and open questions.
>
> **Legend:** 🟢 Feature · 🔵 Enhancement · 🐛 Bug · 📐 Constraint/Principle · 🧱 Tech direction

---

## Session 1 — AI Assistant overhaul, broker integrations, load-state polish

Items 1–5 form one coherent theme: **evolve the one-shot "Insights" analysis into a
full conversational, memory-backed portfolio assistant on its own page.** Item 6 is the
guiding constraint. Item 7 was descoped (moved to a separate project). Items 8–9 and 17
are unrelated first-impression fixes — the load sequence and input focus behaviour.

---

### 1. 🟢 Turn AI analysis into an interactive assistant

**Idea (raw):** Extend AI analysis to be an interactable assistant.

**Refined:** Today the AI feature (`InsightsDrawer` → `/api/insights` → `lib/insights.ts`)
is a **one-shot, read-only report** — it streams a fixed set of sections about the current
portfolio and the user can only regenerate. Upgrade it into a **two-way conversational
assistant**: the user can ask follow-up questions, drill into specific holdings, request
comparisons, and get grounded answers about their portfolio.

**What's needed:**
- Conversational request/response API (multi-turn) instead of the current single-shot
  section stream — a `messages[]` history sent to the model, streamed responses back.
- The assistant must stay **grounded in the user's actual portfolio data** (holdings,
  prices, risk metrics, sector breakdown, price history) — reuse the existing MCP tool
  surface in `lib/mcp/` as the assistant's tool/retrieval layer.
- Preserve the existing quick "analysis" as a first-class assistant action (e.g. a
  starter prompt that produces today's report).
- **Auth path note (checked):** `lib/mcp/` is `server-only` and authenticates
  **bearer token → `user_id`**, built for the remote MCP endpoint, which arrives with no
  cookie. The in-app assistant runs on a **Supabase cookie session**. So call the
  underlying functions (`lib/mcp/portfolio.ts`, `lib/mcp/risk.ts`) server-side and supply
  the user id from the cookie session — do **not** route through `lib/mcp/auth.ts`.
  Reusing the tool *logic* is right; reusing the tool *transport* is not.
- Fix Item 10 first, or inherit it: the current auto-fetch re-fires on every price tick.

**Affected areas:** `components/InsightsDrawer.tsx` (retired/replaced), `lib/insights.ts`,
`app/api/insights/route.ts`, `lib/mcp/tools.ts` (reused as assistant tools), new chat UI.

**Open questions:**
- Keep the fast "generate report" mode as a button inside the chat, or fold it entirely
  into conversation?
- Does chat history persist per portfolio (see Item 4 — memory) or reset each visit?

**Tech note:** built with the existing Next.js/TypeScript stack and Claude (Anthropic)
as the model provider (per the `claude-api` skill / CLAUDE.md). The heavier
LangGraph/LangChain/LlamaIndex showcase was moved out — see descoped Item 7.

---

### 2. 🟢 Move the assistant to its own page (not a modal)

**Idea (raw):** It should be on a separate page, not a modal.

**Refined:** Replace the right-side slide-in drawer with a **dedicated route** (e.g.
`/assistant` or `/portfolio/assistant`). A modal/drawer is too cramped for an ongoing
conversation and doesn't give room for rich responses, tool traces, or chat history.

**What's needed:**
- New App Router page under `app/` (e.g. `app/assistant/page.tsx` + a client view).
- Entry point from the dashboard: the current "Insights" button navigates to the page
  instead of opening the drawer.
- Pass/derive portfolio context (active portfolio id, tickers) on the page — via route
  param, query, or re-fetch from the same store the dashboard uses.

**Affected areas:** `app/` (new route), `components/WatchlistDashboard.tsx` (button →
`Link`), removal of `InsightsDrawer` usage.

**Open questions:**
- URL shape: `/assistant` (global, reads active portfolio) vs
  `/portfolio/[id]/assistant` (explicit)? Explicit is cleaner for multi-portfolio + memory.
- Should the page be full-width, or keep the dashboard visible alongside (split view)?

---

### 3. 🟢 Chat page modeled on Claude's chat UI, with rotating suggested questions

**Idea (raw):** This page should look and behave like Claude's chat page, with some
pre-created questions that differ on each load — a pool of ~15, show 2–3 different ones.

**Refined:** Build the assistant page to **look and behave like Claude.ai's chat**:
centered conversation column, message bubbles, streaming tokens, an input composer pinned
to the bottom, auto-scroll, stop/regenerate controls. On an **empty/new chat**, show
**2–3 suggested starter prompts** drawn from a **pool of ~15**, and **randomize which
ones appear on each load** so it feels fresh.

**What's needed:**
- Chat UI components (message list, streaming message, composer, suggestion chips).
  Must follow the project's design direction (dark, terminal-meets-fintech, monospace for
  data) and the `frontend-design` skill — not a generic template.
- A curated pool of ~15 starter prompts relevant to portfolio analysis, e.g.:
  - "What are my biggest risks right now?"
  - "Which holdings are most correlated?"
  - "How diversified is this portfolio by sector?"
  - "What's driving today's biggest movers?"
  - "If the market drops 10%, which positions hurt most?"
  - (…finalize the full 15 during implementation)
- Client-side random selection of 2–3 on each mount. Note: to avoid hydration mismatch
  with SSR, randomize after mount or seed deterministically.

**Affected areas:** new chat components under `components/assistant/`, `app/assistant/`.

**Open questions:**
- Should suggestions be **static** or **dynamically generated from the actual portfolio**
  (e.g. name the user's real top holding)? Dynamic is more impressive but pricier/slower.
- Exact match to Claude's visual style vs. Port Pulse's own dark fintech skin applied to
  a Claude-like layout? (Leaning: our skin, their layout/behavior.)

---

### 4. 🟢 Assistant as more than plain RAG — Graph RAG with evolving memory

**Idea (raw):** The AI assistant should be more than a usual RAG — maybe graph RAG with
memory. Memory would develop over time.

**Refined:** Rather than naive "embed docs → top-k retrieve → stuff context," build a
**Graph RAG** system: model the portfolio domain as a **knowledge graph** (holdings,
sectors, correlations, risk factors, historical events, user's stated goals/preferences)
and retrieve over that structure for richer, relationship-aware answers. Layer in
**long-term memory** that **accumulates across sessions** — the assistant remembers prior
conversations, the user's preferences, risk tolerance, recurring questions, and past
observations, and gets more personalized over time.

**What's needed:**
- **Graph layer:** decide graph store (e.g. in-Postgres/pgvector relational graph via
  Supabase, or a dedicated graph store). Nodes: tickers, sectors, factors, portfolios,
  user-goals. Edges: holds, belongs-to-sector, correlated-with, exposed-to-factor.
- **Retrieval:** graph traversal + vector search hybrid to assemble grounded context.
- **Memory subsystem:** persistent per-user memory (facts, preferences, conversation
  summaries) that is written after conversations and recalled on future ones. Needs a
  storage schema + a recall/ranking step + a "what's worth remembering" extraction step.
- Guardrails so memory stays accurate and correctable (user can view/clear it).

**Affected areas:** new `lib/assistant/` (graph + memory + retrieval), Supabase schema
additions (memory tables, graph edges, embeddings), integration with the MCP data layer.

**Open questions:**
- Graph store choice: stay all-Supabase (simplest, one DB) vs. add a graph DB?
- Memory scope: per-user, or per-user-per-portfolio? (Portfolio-scoped is cleaner.)
- Privacy: memory persists real financial context — needs RLS + a clear/export control.
- Build within the Next.js/TS stack (e.g. pgvector on Supabase + lightweight retrieval)
  rather than a heavy Python RAG framework — the framework showcase moved to its own
  project (descoped Item 7). Keep this pragmatic and shippable here.
- **Should the graph and the memory be separate items?** (Review note, undecided — the
  argument for splitting, so it isn't lost:) the two halves have very different
  cost/benefit here. **Memory** — preferences, risk tolerance, conversation summaries — is
  small, clearly valuable, and independent. **Graph retrieval** is solving a problem this
  app may not have: 12–25 holdings fit in a prompt with room to spare, so there is no
  retrieval-at-scale pressure; the relationships a graph would encode (`correlated-with`,
  `exposed-to-factor`) are **computed from price history, not stored facts**, so edges
  would be a cache that goes stale and gets recomputed anyway; and `lib/mcp/` already
  provides typed structured access to exactly the entities the graph would model.
  Graph RAG would start earning its complexity against a real corpus — filings, news,
  transcripts, or years of conversation history. Worth deciding deliberately rather than
  discovering mid-build.

---

### 5. 🟢 Broker integrations — Freedom Finance & Interactive Brokers

**Idea (raw):** Interaction with Freedom Finance and Interactive Brokers via API or MCP
or something.

**Refined:** Let the app **pull portfolio data directly from brokers** —
**Freedom Finance** and **Interactive Brokers (IBKR)** — instead of relying solely on
screenshot parsing. Connect via each broker's **API**, or via an **MCP integration** where
one exists (note: an `Interactive_Brokers_IBKR` MCP connector already appears in this
environment's tool list, worth evaluating).

**What's needed:**
- Research each broker's read access: IBKR Client Portal API / Web API; Freedom Finance
  available API surface (may be limited — investigate).
- Auth handling per broker (OAuth / session / API keys), stored securely.
- A normalization layer mapping broker holdings → the app's `Ticker`/portfolio model, so
  imported data flows through the same pipeline as parsed screenshots.
- **Read-only** access scopes only (see Item 6).

**Affected areas:** new `lib/brokers/` (per-broker adapters), new API routes for
connect/sync, portfolio import path in `lib/portfolios.ts` / storage.

**Open questions:**
- Does Freedom Finance expose a usable public API for retail read access? (Unknown —
  needs research; may block this half of the item.)
- Prefer official API vs. MCP connector for IBKR? Evaluate the existing MCP option first.
- Sync model: one-time import vs. periodic refresh vs. live?

---

### 6. 📐 Constraint — the app is read-only / analysis only

**Idea (raw):** Just to confirm, the whole app is for read-only and analysis purposes,
not write.

**Refined:** **Firm principle:** Port Pulse **never places trades or mutates broker/account
state.** Every integration (Item 5), every assistant capability (Items 1–4), and every
MCP tool is **read + analyze only**. When connecting brokers, request **read-only scopes**;
when designing assistant tools, none may perform account-changing actions.

**Applies to:** Items 1, 4, 5 especially. This is a hard boundary, not a nice-to-have.

**Open questions:** None — this is a decided constraint. Flagged here so every later item
inherits it.

---

### 7. 🧱 ~~Tech direction — showcase-grade complex RAG stack~~ — **DESCOPED**

> **Status: moved to a separate project** (decided Session 1). The idea was to make Port
> Pulse a reference-quality showcase of a sophisticated RAG/agent stack — **LangGraph**
> (agent orchestration), **LangChain** (chains/tools), possibly **LlamaIndex** (indexing).
> Those tools are strongest in **Python**, which fights this app's **Next.js/TypeScript**
> runtime. Rather than bolt a Python brain onto Port Pulse, the framework showcase will be
> built as its **own dedicated project**.
>
> **Impact on Port Pulse:** the assistant (Items 1 & 4) is still built here, but with the
> **native TS stack + Claude** — pragmatic Graph RAG / memory (e.g. pgvector on Supabase),
> not a heavy framework. Kept in this list (numbering = order raised) as a record of the
> decision.

**Original idea (raw):** Use this project to create a perfect example with complex RAG.
Ideally LangGraph, LangChain, maybe LlamaIndex and other modern tools.

---

### 8. 🐛 Bug — eliminate the empty-state flash on initial load

**Idea (raw):** When I open the app I see a loading state (correct), then an empty state,
then everything appears all at once. I want to eliminate the empty-state step.

**Refined:** On first load there's an incorrect **three-step flash: loading → "empty
portfolio" → content**. The "empty" step is wrong — the portfolio isn't actually empty,
its data just hasn't hydrated yet. The UI should go **loading → content** with no empty
flash in between.

**Root cause (identified):** In `components/WatchlistDashboard.tsx`,
`portfolioReady = !isLoggedIn || activeId != null`. Once an active portfolio id resolves,
`portfolioReady` becomes `true` **before the tickers for that portfolio have loaded**, so
`EmptyPortfolio` renders its real "This portfolio is empty" branch for a frame, then
tickers arrive and content swaps in. The readiness signal conflates "portfolio selected"
with "portfolio data loaded."

**What's needed:**
- Introduce a distinct **"tickers loaded/hydrated"** signal and only show the empty state
  once loading is genuinely complete **and** the portfolio truly has zero holdings.
- Until then, keep showing the loading state (which pairs with Item 9's richer loader).

**Affected areas:** `components/WatchlistDashboard.tsx` (`portfolioReady` logic,
`EmptyPortfolio` gating), possibly the store/hook that loads tickers.

**Open questions:**
- Where does ticker hydration state live, and is there already a loading flag to reuse or
  does one need to be added? (Confirm during implementation.)

---

### 9. 🔵 Enhancement — sophisticated loading state

**Idea (raw):** Create a sophisticated loading state; the current one is very simple.

**Refined:** The current loader is a bare centered "Loading portfolio…" line
(`EmptyPortfolio` `ready=false` branch in `WatchlistDashboard.tsx`). Replace it with a
**polished, on-brand loading experience** — e.g. skeleton rows/cards matching the real
table & panels, subtle shimmer, and the dark terminal-fintech aesthetic — so the app feels
premium from the first frame and the layout doesn't jump when content arrives.

**What's needed:**
- Skeleton components mirroring the dashboard layout (header stats, sector breakdown, risk
  panel, table/heatmap rows).
- Follow the `frontend-design` skill and the design direction in CLAUDE.md (no generic
  spinners; subtle glow/shimmer; monospace accents).
- Coordinate with Item 8 so the loader shows for the full hydration window (no premature
  empty state).

**Affected areas:** `components/WatchlistDashboard.tsx`, new skeleton components under
`components/`.

**Open questions:**
- Full skeleton of every panel, or a lighter branded loader? (Skeleton is more premium and
  prevents layout shift.)

---

### 17. 🐛 Bug — iOS Safari zooms the page when an input is focused

**Idea (raw):** When I tap Add ticker (and probably other inputs) the UI zooms in a bit.
It looks like default behaviour — get rid of it.

**Refined:** iOS Safari **auto-zooms on focus whenever the focused field's computed
`font-size` is under 16px**. It then leaves the page zoomed after blur, so the whole layout
stays shifted. It is default behaviour, and it is entirely avoidable — 16px is the trigger,
not something Safari decides.

**Root cause (confirmed):** every text input in the app is `text-sm` = **14px**.

| Input | File | Type |
|---|---|---|
| Ticker search | `components/AddTickerModal.tsx:135` | `text` |
| Quantity / entry price | `components/AddTickerModal.tsx:309` | `number` — zooms too |
| Portfolio name | `components/PortfolioModal.tsx:124` | `text` |

`components/Uploader.tsx:172` is a hidden `type="file"` and is **not** affected.

**What's needed:**
- Raise the focused font-size to **≥16px at mobile widths**: `text-base lg:text-sm`, so
  desktop keeps its density. That is the whole fix.
- **Do not reach for `maximum-scale=1` / `user-scalable=no`** on the viewport. It suppresses
  the zoom by **disabling pinch-zoom entirely** — a WCAG 1.4.4 failure, and precisely the
  kind of fix that makes the app worse for anyone who needs to magnify it. The `viewport`
  export in `app/layout.tsx` is deliberately free of it; keep it that way.
- Treat 16px as a standing rule for any future input, not a one-off patch.

**Affected areas:** `components/AddTickerModal.tsx`, `components/PortfolioModal.tsx`.

**Open questions:**
- Does 16px read as intentional in the modals, or does the surrounding label/spacing scale
  need a nudge so the input doesn't just look oversized?

---

## Session 2 — carried over from the mobile redesign

Items 10–16 were all found while building the mobile redesign and deliberately left
unfixed as out of scope. **Item 10 is the one that matters most** — Item 1 inherits it
directly. Item 11 is a live regression in shipped code.

---

### 10. 🐛 Bug — Insights re-fires its AI call on every price tick

**Idea (raw):** Found during the mobile redesign (Task 14) and left alone as out of scope.

**Refined:** `useInsights`' auto-fetch effect depends on `fetchInsights`, a `useCallback`
whose deps include `cacheKey` → `hashHoldings` → **the live price**. So while
`InsightsDrawer` is open, every price tick changes the key and **re-fires the auto-fetch**.
The same key drives the `sessionStorage` cache, which therefore **can never hit during
market hours** — it only appeared to work in testing because the market was closed.

**Why this is the highest-priority item here:** Item 1 turns this surface into a
conversational assistant. A chat that re-sends on every tick is not a minor inefficiency —
it is a per-tick Claude call.

**What's needed:**
- Decide whether the cache key should contain price at all. A price-free key
  (`symbol:qty:entry`, sorted) still invalidates correctly when holdings change, which is
  the only thing that should invalidate an analysis.
- The mobile AI tab (`components/mobile/sheet/InsightsTab.tsx`) already works around this
  with a module-level `autoGenerated` guard keyed on a price-free `holdingsKey`. Either
  lift that into `useInsights` so both callers benefit, or fix `hashHoldings` directly.

**Affected areas:** `components/insights/useInsights.ts`,
`components/insights/stream.ts` (`hashHoldings`), `components/InsightsDrawer.tsx`,
`components/mobile/sheet/InsightsTab.tsx`.

**Open questions:**
- Fix in the hook (both callers benefit, but changes shipped desktop behaviour) vs. keep
  per-caller guards?
- Should a price change *ever* invalidate an analysis? Arguably a large move should, but
  a one-cent tick clearly shouldn't — is there a threshold worth having?

---

### 11. 🐛 Bug — sheet swipe does nothing under touch

**Idea (raw):** "this bottom section is opening only on click, shouldn't it be by swipe?"

**Refined:** The analytics sheet has pointer-based swipe handlers on its header — drag up
past 32px opens, down closes. These **work under mouse input and do nothing under touch.**
Tap-to-toggle works, so the sheet is usable but the gesture is dead.

**Process failure worth recording:** the verification pass that reported swipe "working"
drove it with CDP `pointerType: "mouse"`, which **bypasses the touch path entirely**. It
was never evidence about touch. Any future gesture work must be verified with real touch
event sequences (`Input.dispatchTouchEvent` / touch emulation), and a mouse-only pass on a
touch feature should be treated as unverified.

**What's needed:**
- Root cause (diagnosis in flight at time of writing). Leading candidates:
  React's root-level event delegation not seeing pointer events once `setPointerCapture`
  retargets them; a `pointercancel` firing because the browser claims the gesture as a
  scroll despite `touch-action: none`; or too few `pointermove` events arriving to cross a
  32px threshold inside a 57px bar.
- Likely fix shape: native listeners via `ref` + `useEffect` with `{ passive: false }`
  rather than React synthetic pointer handlers.
- Must preserve: tap-to-toggle, no trailing click undoing a drag, Escape and backdrop-tap
  to close, and the working mouse path.

**Affected areas:** `components/mobile/AnalyticsSheet.tsx`.

**Open questions:**
- **Threshold commit or live-following drag?** Currently a threshold commit. Follow-the-
  finger is what iOS sheets do and probably what "swipe" means to a user — but the tab
  content is only mounted while the sheet is open, so following the finger would drag open
  an empty box unless the content is pre-mounted. Owner asked; not yet answered.

---

### 12. 🔵 Enhancement — no rate limiting on any endpoint

**Idea (raw):** Surfaced while reviewing the new public history endpoint.

**Refined:** **No endpoint in this repo is rate limited.** There are now three public,
unauthenticated compute endpoints — `/api/risk`, `/api/sectors`, `/api/portfolio-history` —
each of which fans out to Yahoo per symbol (capped at 60 holdings, so up to 60 upstream
requests per request). Pre-existing, not introduced by the redesign.

**Why it stops being theoretical:** Items 1–4 add an **AI chat endpoint**. An
unauthenticated route that costs money per call is a different risk class from one that
costs a Yahoo fetch.

**What's needed:**
- Decide the boundary: per-IP, per-session, or require auth for the AI endpoint
  specifically (the compute endpoints are public by design so the app works signed out —
  the assistant arguably shouldn't be).
- Vercel-friendly mechanism (edge middleware + a KV/Upstash counter, or Vercel's own
  rate limiting) rather than in-process state, which doesn't survive serverless.

**Affected areas:** new `middleware.ts`, `app/api/*` routes, whatever the assistant adds.

**Open questions:**
- Should the AI assistant require sign-in? That would resolve most of this by itself and
  is defensible — memory (Item 4) needs an identity anyway.

---

### 13. 🐛 Bug — signed-out holdings don't persist

**Idea (raw):** Found during the redesign's verification pass.

**Refined:** `lib/storage.ts` states *"Logged out: drop everything (in-memory only, no
persistence)"* — guest holdings vanish on reload. **This contradicts the original brief in
CLAUDE.md**, which specifies that when not signed in, "everything works, state lives in
`sessionStorage`". A repo-wide grep finds `sessionStorage` used only for `pp:view:v1`,
`pp:mobile-sort:v1` and the insights cache — never the watchlist.

**What's needed:**
- Decide which is correct: the brief (persist to `sessionStorage`) or the current code
  (in-memory only). If the brief, add a guest persistence path; if the code, update
  CLAUDE.md so the two stop disagreeing.

**Affected areas:** `lib/storage.ts`, `CLAUDE.md`.

**Open questions:**
- `sessionStorage` (dies with the tab) or `localStorage` (survives)? The brief says
  session; local would be friendlier for a guest who closes the tab mid-upload.

---

### 14. 🔵 Enhancement — `TickerTableRow` re-derives holdings maths inline

**Idea (raw):** Surfaced by review during the redesign; deliberately not fixed because
desktop was an explicit non-goal.

**Refined:** `components/TickerTableRow.tsx` computes market value, cost basis, unrealized
P&L and portfolio weight **inline**, duplicating `marketValue`, `costBasis`,
`unrealizedPl` and `weightPct` from the now-tested `lib/holdings.ts`. The desktop table
and the mobile list therefore derive the same figures two different ways — a live
divergence risk against the module that exists to prevent exactly that.

**Note:** the P&L inflation bug fixed during the redesign was this class of problem. Worth
doing before the next numbers bug rather than after.

**What's needed:** point `TickerTableRow` at `lib/holdings.ts`, passing `quotes` in the way
`HoldingRow` does. Behaviour-preserving; verify the desktop table renders identically.

**Affected areas:** `components/TickerTableRow.tsx`, `components/PortfolioTable.tsx`.

**Open questions:** none — mechanical.

---

### 15. 🔵 Enhancement — `/position/[symbol]` has no mobile pass

**Idea (raw):** Explicitly scoped out of the mobile redesign.

**Refined:** The redesign covered the dashboard below 1024px only. The position detail page
(`app/position/[symbol]/`) was never audited or adapted for phone width — and it is one tap
from every holding row, so it is on the main mobile path.

**What's needed:** the same audit the dashboard got — measure the vertical budget at 393px,
check `PositionChart`'s fixed heights, tap-target sizes, and whether `PositionHoldings`'
table shape works on a phone.

**Affected areas:** `app/position/[symbol]/`, `components/position/*`.

**Open questions:**
- Does the chart want the same range-chip treatment the hero got, for consistency?

---

### 16. 🔵 Enhancement — silence the Recharts size warnings

**Idea (raw):** Noticed throughout the redesign's verification.

**Refined:** Recharts logs `The width(0) and height(0) of chart should be greater than 0`
(and a `width(-1)` variant) — measured at **~490 occurrences in one session**. It comes
from `ResponsiveContainer` measuring before layout settles, in `SectorBreakdown` and
`PortfolioHeatmap`. Pre-existing and harmless, but it buries real errors in the console.

**What's needed:** give the containers an explicit initial size, or gate rendering until
the container has measured. Confirm which components are actually responsible first — it
fires in both the 393px and 1440px layouts.

**Affected areas:** `components/SectorBreakdown.tsx`, `components/PortfolioHeatmap.tsx`,
possibly `components/mobile/PortfolioHero.tsx`.

**Open questions:** none.

---

## Parking lot / to revisit
- Finalize the full list of 15 starter prompts (Item 3).
- Research Freedom Finance API availability (Item 5) — treat as **likely blocked** rather
  than merely unresearched; retail read APIs there are not clearly public.
- Spike IBKR read access before committing to it (Item 5): the Client Portal API has
  historically wanted a locally-running gateway or heavy OAuth, neither of which suits a
  Vercel-hosted app. Evaluate the MCP connector first.
- (Separate project) Spin up the LangGraph/LangChain RAG showcase — descoped from here (Item 7).
- Answer the swipe feel question (Item 11) — threshold commit vs. follow-the-finger.
