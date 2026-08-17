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
guiding constraint. Item 7 was descoped (moved to a separate project). Items 8–9 are
unrelated load-state fixes.

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

## Parking lot / to revisit
- Finalize the full list of 15 starter prompts (Item 3).
- Research Freedom Finance API availability (Item 5).
- (Separate project) Spin up the LangGraph/LangChain RAG showcase — descoped from here (Item 7).
