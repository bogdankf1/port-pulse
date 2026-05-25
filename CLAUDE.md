# Portfolio Live Tracker — Project Brief

## What we're building

A web app where a user uploads a screenshot of their investment portfolio (from any broker — Robinhood, Interactive Brokers, eToro, etc.), Claude Vision parses the tickers from it, and a live dashboard appears showing real-time prices via WebSocket.

The owner uses this personally to monitor two separate portfolios. Auth is optional — the app works without signing in, but signing in with Google saves the watchlist to Supabase so it persists across sessions.

---

## Core user flow

1. Land on the app → clean upload UI, optional "Sign in with Google" in the top-right corner
2. Drag & drop (or click to upload) a portfolio screenshot
3. Claude Vision API parses the screenshot → extracts ticker symbols
4. Dashboard appears with live prices streaming in via Finnhub WebSocket
5. User can upload a second portfolio → tickers are merged into the same dashboard
6. If signed in → watchlist is saved to Supabase automatically

---

## Tech stack

- **Framework:** Next.js 14+ (App Router) + TypeScript
- **Auth + DB:** Supabase (Google OAuth + Postgres)
- **AI:** Anthropic Claude API (claude-sonnet-4-20250514) — Vision, for parsing screenshots
- **Live prices:** Finnhub WebSocket API
- **Styling:** Tailwind CSS

---

## Design direction

**Follow the frontend-design skill approach** — this should look like a premium, opinionated financial tool. Not generic, not Bootstrap-ish.

Aesthetic direction: **dark theme, refined and data-dense but not cluttered**. Think terminal meets modern fintech — clean typography, subtle glows or gradients on live data, smooth animations on price updates (green flash up, red flash down).

Specific requirements:
- Dark background (deep navy or near-black, not pure #000)
- Monospace or semi-monospace font for prices/tickers (feels native to trading)
- Price change animations — green/red flash when a value updates
- Responsive: looks great on mobile, tablet, and desktop
- Upload area should feel inviting — large, clear, with a subtle dashed border or illustrated hint
- Dashboard should feel like a real trading tool, not a side project

Avoid: purple gradients, Inter font, generic card layouts, anything that looks like a template.

---

## Project structure

```
app/
  page.tsx                  # Upload screen (landing)
  dashboard/
    page.tsx                # Live watchlist dashboard
  api/
    parse/route.ts          # Claude Vision API call — receives image, returns tickers
    watchlist/route.ts      # Supabase CRUD for saved watchlists (auth only)
  auth/
    callback/route.ts       # Supabase OAuth callback

components/
  Uploader.tsx              # Drag & drop upload component
  TickerRow.tsx             # Single row: symbol, name, price, change %, live indicator
  WatchlistDashboard.tsx    # Full dashboard, manages WebSocket connection
  AuthButton.tsx            # Sign in / Sign out with Google

lib/
  supabase.ts               # Supabase client (browser + server)
  finnhub.ts                # Finnhub WebSocket manager
  claude.ts                 # Anthropic client + parse function

types/
  index.ts                  # Ticker, WatchlistItem, ParseResult types
```

---

## Supabase schema

```sql
-- Only used when user is signed in
create table watchlist_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  symbol text not null,
  name text,
  created_at timestamptz default now()
);

-- RLS: users can only read/write their own rows
alter table watchlist_items enable row level security;

create policy "Users manage own watchlist"
  on watchlist_items
  for all
  using (auth.uid() = user_id);
```

---

## Claude Vision — parse route

`POST /api/parse`

- Receives: `multipart/form-data` with an image file
- Sends to Claude API as a vision message with this prompt:

```
You are parsing a portfolio screenshot from a brokerage app.
Extract all stock or crypto ticker symbols visible in the image.
Return ONLY a JSON array of objects, no explanation, no markdown.
Format: [{ "symbol": "AAPL", "name": "Apple Inc." }, ...]
If you cannot identify a ticker with confidence, skip it.
```

- Returns: `{ tickers: [{ symbol: string, name: string }] }`
- Handle errors gracefully — if Claude returns nothing useful, return a clear error message to display in the UI

---

## Finnhub WebSocket

- Connect once when dashboard mounts: `wss://ws.finnhub.io?token=YOUR_TOKEN`
- Subscribe to each ticker: `{ type: "subscribe", symbol: "AAPL" }`
- On message: update the price for the matching ticker in local state
- Unsubscribe + close on unmount
- Show a subtle "live" indicator (pulsing green dot) when connected

---

## Auth behaviour

- Google sign-in via Supabase OAuth — one button, top-right corner
- If signed in:
  - After parsing, save tickers to `watchlist_items` table
  - On next visit, load saved watchlist automatically (skip upload step if watchlist exists)
  - Show a "Clear watchlist" option
- If not signed in:
  - Everything works, state lives in `sessionStorage`
  - Show a subtle "Sign in to save your watchlist" nudge (not a blocker)

---

## Environment variables needed

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_FINNHUB_TOKEN=
```

---

## What to build first (suggested order)

1. Project setup — `create-next-app`, install deps, set up env vars
2. Supabase client + Auth (Google OAuth) — get sign in/out working
3. Upload component + Claude parse route — core feature, get tickers from a screenshot
4. Finnhub WebSocket hook + TickerRow — live prices working
5. Dashboard page — wire everything together
6. Styling pass — apply the design direction, animations, mobile polish
7. Auth-gated persistence — save/load watchlist for signed-in users

---

## Future scope (do not build now)

- P&L tracking (needs purchase price + quantity from screenshot)
- Price alerts
- Multiple named watchlists
- Chart per ticker (candlestick or line, clicking a row expands it)
- Supabase Realtime to sync across tabs
- PWA / mobile install

---

## Notes

- Keep it simple — this is a focused tool, not a full trading platform
- All API keys go in `.env.local`, never committed
- No external UI component libraries — custom components only, styled with Tailwind
- The app should be fully usable on mobile (portrait) — the dashboard especially

---

## Superpowers — always use the right skill for the job

Always invoke the appropriate skill when its trigger conditions apply. Don't reinvent what a skill already does. Match the task to the skill below:

**Code quality & verification**
- `verify` — after any non-trivial change, run the app and confirm the change actually works in the browser (not just type-checks). Required before reporting a UI/frontend task as done.
- `simplify` — after writing or changing code, sweep for reuse opportunities, dead code, premature abstractions, and over-engineering. Fix what you find.
- `review` — review a pull request end-to-end.
- `security-review` — before shipping anything that touches auth, API keys, user input, file uploads (Uploader.tsx), or the parse route. This project has all of those.

**Running the app**
- `run` — launch the Next.js dev server and drive the app to see a change working. Use whenever you need to confirm behavior in the real app.

**Claude API work**
- `claude-api` — REQUIRED whenever touching `lib/claude.ts`, `app/api/parse/route.ts`, or anything calling the Anthropic SDK. Covers prompt caching, model selection (Opus/Sonnet/Haiku), vision usage, and migrations between Claude versions.

**PR workflow**
- `review-pr` — review a specific PR by number.
- `address-review` — respond to and implement review feedback on your own PR.
- `implement-ticket` — implement a ticket from scratch given a ticket number and description.

**Harness & environment**
- `update-config` — any time the user wants to change `settings.json`, add permissions, set env vars, configure hooks, or set up automated behaviors ("from now on when X").
- `fewer-permission-prompts` — when permission prompts are getting noisy, scan transcripts and add a safe allowlist.
- `keybindings-help` — rebinding keys or editing `~/.claude/keybindings.json`.

**Scheduling & loops**
- `loop` — run a prompt/slash command on a recurring interval (e.g. poll a deploy every 5m). Not for one-off tasks.
- `schedule` — create cron-scheduled remote agents, or one-time future runs ("remind me to check X tomorrow").

**Figma**
- `figma:figma-use` — MANDATORY before any `use_figma` write/JS-execution call.
- `figma:figma-generate-diagram` — MANDATORY before any `generate_diagram` call.
- `figma:figma-implement-design` — translating a Figma file into production code.
- `figma:figma-generate-design` — pushing an app page/view back into Figma.
- `figma:figma-generate-library` — building or updating a design system in Figma from code.
- `figma:figma-create-design-system-rules` — generating project-specific Figma-to-code rules.
- `figma:figma-code-connect` — creating/maintaining `.figma.ts`/`.figma.js` Code Connect templates.
- `figma:figma-use-figjam` — when working in a FigJam (not Figma) file via the MCP tool.

**Telegram**
- `telegram:configure` — first-time setup (saving bot token, reviewing policy).
- `telegram:access` — pair, approve, edit allowlists, or change channel policy.

**Project setup**
- `init` — initialize a new `CLAUDE.md` (this file already exists — skip).
