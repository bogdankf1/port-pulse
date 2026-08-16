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
