"use client";

import { useRouter } from "next/navigation";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import { formatMoney, formatQty, plColor, signed } from "@/lib/format";
import type { Ticker } from "@/types";

/** Width of the revealed delete action. Half of it is the commit threshold. */
const ACTION_WIDTH = 88;

/** Movement before the gesture picks an axis. Below this a touch is still
 *  ambiguous between a tap, a list scroll, and a swipe. */
const AXIS_SLOP = 8;

type Props = {
  ticker: Ticker;
  quotes: Quotes;
  totalValue: number;
  onRemove: () => void;
  /** Owned by the list so only one row sits open at a time. */
  swipeOpen: boolean;
  onSwipeOpenChange: (open: boolean) => void;
};

export function HoldingRow({
  ticker,
  quotes,
  totalValue,
  onRemove,
  swipeOpen,
  onSwipeOpenChange,
}: Props) {
  const router = useRouter();
  const profile = useCompanyProfile(ticker.symbol);
  const [expanded, setExpanded] = useState(false);
  const panelId = `holding-${ticker.symbol}`;

  // Live finger offset in px, non-null only mid-drag. At rest the row's
  // position is derived from `swipeOpen` alone, so a row losing the open slot
  // to a sibling retracts without any state to keep in sync.
  const [drag, setDrag] = useState<number | null>(null);
  const offset = drag ?? (swipeOpen ? ACTION_WIDTH : 0);
  // Mirrors `drag` for the release decision. A fast flick can deliver its last
  // pointermove and the pointerup in one batch, leaving the handler's closure
  // on the pre-drag offset — the ref is current either way.
  const dragRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const axisRef = useRef<"none" | "h" | "v">("none");
  const baseRef = useRef(0);
  const draggedRef = useRef(false);

  function closeSwipe() {
    dragRef.current = null;
    setDrag(null);
    onSwipeOpenChange(false);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    axisRef.current = "none";
    baseRef.current = offset;
    dragRef.current = null;
    draggedRef.current = false;
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (start == null) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    if (axisRef.current === "none") {
      if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
      // Ties go to the vertical axis so a sloppy diagonal flick still scrolls
      // the list rather than peeling a row open.
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (axisRef.current === "v") {
        // Hand the gesture back to the browser for the rest of the touch.
        startRef.current = null;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    draggedRef.current = true;
    // Leftward only. Dragging right on a closed row clamps to 0, so the row
    // simply doesn't move — there is no second action to reveal.
    const next = Math.min(ACTION_WIDTH, Math.max(0, baseRef.current - dx));
    dragRef.current = next;
    setDrag(next);
  }

  function handlePointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const wasHorizontal = axisRef.current === "h";
    startRef.current = null;
    axisRef.current = "none";
    if (!wasHorizontal) return;
    // Both updates land in one batch, so the row never renders at the pre-snap
    // offset with the new open state.
    const open = (dragRef.current ?? offset) > ACTION_WIDTH / 2;
    dragRef.current = null;
    setDrag(null);
    onSwipeOpenChange(open);
  }

  function handleRowClick() {
    // The drag already settled the state — don't let the trailing click expand.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (offset > 0) {
      closeSwipe();
      return;
    }
    setExpanded((v) => !v);
  }

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
  // day, swap both branches for `bg-slate-500/10` — this is a deliberate open
  // question to settle in the browser during the final verification pass.
  const fillClass =
    dayPct == null
      ? "bg-slate-400/10 dark:bg-slate-500/10"
      : dayPct >= 0
        ? "bg-emerald-500/10 dark:bg-emerald-400/10"
        : "bg-red-500/10 dark:bg-red-400/10";

  // Header and expanded panel are siblings, so they share the transform rather
  // than being wrapped in one more layer.
  const slideStyle = { transform: `translateX(-${offset}px)` };
  const slideClass =
    drag != null ? "" : "transition-transform duration-200 ease-out";

  return (
    <div
      className={`relative overflow-hidden border-b border-slate-200 dark:border-slate-800/70 ${flashClass}`}
    >
      {/* Sized to the strip the row has vacated rather than parked full-width
          behind it: the sliding layers are transparent — the flash animates
          their own background and the body gradient shows through — so an
          action sitting underneath would bleed through the holding's content. */}
      {offset > 0 && (
        <div
          className="absolute inset-y-0 right-0 overflow-hidden"
          style={{ width: `${offset}px` }}
        >
          <button
            type="button"
            onClick={() => {
              closeSwipe();
              onRemove();
            }}
            aria-label={`Remove ${ticker.symbol}`}
            style={{ width: `${ACTION_WIDTH}px` }}
            className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-red-600 text-white"
          >
            <TrashIcon />
            <span className="font-mono text-[10px] font-medium">Delete</span>
          </button>
        </div>
      )}

      <div
        className={`relative ${slideClass}`}
        // pan-y keeps vertical scrolling native while the horizontal axis stays
        // ours; `none` here would make the list unscrollable from any row.
        style={{ ...slideStyle, touchAction: "pan-y" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
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
          onClick={handleRowClick}
          aria-expanded={expanded}
          aria-controls={panelId}
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
                <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                  {weight.toFixed(1)}%
                </span>
              )}
            </span>
            <span className="block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {ticker.quantity != null
                ? `${formatQty(ticker.quantity)} ${ticker.quantity === 1 ? "share" : "shares"} · `
                : ""}
              {value != null ? `$${formatMoney(value)}` : ticker.name || profile.name || "—"}
            </span>
          </span>

          <span className="shrink-0 text-right">
            <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {price != null ? `$${price.toFixed(2)}` : "…"}
            </span>
            <span className="block font-mono text-[11px] tabular-nums">
              <span className={dayPct == null ? "text-slate-400" : plColor(dayPct)}>
                {dayPct != null ? signed(dayPct, (v) => `${v.toFixed(2)}%`) : "—"}
              </span>
              {pl != null && (
                <span className={`ml-1.5 ${plColor(pl)}`}>
                  {signed(pl, (v) => `$${formatMoney(v)}`)}
                </span>
              )}
            </span>
          </span>
        </button>
      </div>

      {expanded && (
        <div
          id={panelId}
          className={`relative border-t border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-slate-800/70 dark:bg-slate-900/50 ${slideClass}`}
          style={slideStyle}
        >
          {/* Qty and % of portfolio deliberately absent — both are already on
              the collapsed row. Total return joins the grid rather than sitting
              orphaned underneath it. */}
          {/* Removal lives on the row's swipe action, so the only button left
              here rides alongside Return rather than on its own line. */}
          <div className="flex items-center gap-2">
            <dl className="grid flex-1 grid-cols-4 gap-2 text-center">
              <Detail
                label="Entry"
                value={ticker.entryPrice != null ? `$${ticker.entryPrice.toFixed(2)}` : "—"}
              />
              <Detail label="Cost" value={cost != null ? `$${formatMoney(cost)}` : "—"} />
              <Detail
                label="Day $"
                value={dayAbs != null ? signed(dayAbs, (v) => `$${formatMoney(v)}`) : "—"}
                tone={dayAbs != null ? plColor(dayAbs) : undefined}
              />
              <Detail
                label="Return"
                value={plPct != null ? signed(plPct, (v) => `${v.toFixed(1)}%`) : "—"}
                tone={plPct != null ? plColor(plPct) : undefined}
              />
            </dl>
            <button
              type="button"
              onClick={() => router.push(`/position/${encodeURIComponent(ticker.symbol)}`)}
              aria-label={`Open ${ticker.symbol} position`}
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <OpenIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OpenIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
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
