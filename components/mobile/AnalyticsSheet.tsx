"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";

/** Vertical travel that commits a swipe. Short enough to feel responsive,
 *  long enough that a sloppy tap doesn't register as a drag. */
const DRAG_THRESHOLD = 32;

export type SheetTab = "mix" | "risk" | "heatmap" | "ai";

const TABS: { id: SheetTab; label: string }[] = [
  { id: "mix", label: "Mix" },
  { id: "risk", label: "Risk" },
  { id: "heatmap", label: "Heatmap" },
  { id: "ai", label: "AI" },
];

type Props = {
  /**
   * One-line summary shown while collapsed, e.g. the allocation bar.
   *
   * Must be **non-interactive** — it renders inside the toggle `<button>`, so
   * any focusable child would be invalid markup and its clicks would fight the
   * toggle. If an interactive peek is ever needed, lift `peek` out of the
   * button and narrow the toggle affordance to the drag handle.
   */
  peek: ReactNode;
  children: (tab: SheetTab) => ReactNode;
};

export function AnalyticsSheet({ peek, children }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SheetTab>("mix");
  const dragStartY = useRef<number | null>(null);
  const draggedRef = useRef(false);

  // Swipe up to open, down to close. Deliberately a threshold commit rather
  // than a live-following drag: the sheet's content only exists while open, so
  // following the finger would drag open an empty box. Gestures start on the
  // header, which is not a scroll container, so this never fights the list.
  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    dragStartY.current = e.clientY;
    draggedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const start = dragStartY.current;
    if (start == null) return;
    const dy = e.clientY - start;
    if (Math.abs(dy) < DRAG_THRESHOLD) return;
    draggedRef.current = true;
    dragStartY.current = null;
    setOpen(dy < 0);
  }

  function handlePointerEnd(e: ReactPointerEvent<HTMLButtonElement>) {
    dragStartY.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function handleClick() {
    // The drag already set the state — don't let the trailing click undo it.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setOpen((v) => !v);
  }

  return (
    <>
      {/* Clears the peek bar so the last holding and the total are never
          trapped underneath it. The collapsed bar measures 57px — min-h-[56px]
          is border-box, so its padding is already inside that, plus the 1px
          border-top — and the inset must be added because the bar pads by it. */}
      <div
        aria-hidden
        style={{ height: "calc(60px + env(safe-area-inset-bottom))" }}
      />

      {open && <SheetBackdrop onClose={() => setOpen(false)} />}

      <div
        className={`fixed inset-x-0 bottom-0 z-40 overflow-hidden rounded-t-2xl border-t border-slate-300 bg-white shadow-[0_-8px_32px_-12px_rgba(0,0,0,0.35)] transition-[max-height] duration-200 ease-out dark:border-slate-700 dark:bg-slate-900 ${
          open ? "max-h-[85vh]" : "max-h-[112px]"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          aria-expanded={open}
          aria-label={open ? "Collapse analytics" : "Expand analytics"}
          // touch-action: none so a vertical drag here is a sheet gesture
          // rather than a page scroll.
          style={{ touchAction: "none" }}
          className="flex min-h-[56px] w-full cursor-grab flex-col items-stretch gap-2 px-4 pb-2 pt-2.5 active:cursor-grabbing"
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
                  className={`inline-flex min-h-[36px] flex-1 items-center justify-center rounded-md border font-mono text-[11px] font-medium transition-colors ${
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
