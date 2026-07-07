"use client";

import { useEffect } from "react";
import type { Ticker } from "@/types";
import { SECTION_KEYS, toResponse } from "./insights/stream";
import { useInsights } from "./insights/useInsights";
import { SectionCard } from "./insights/SectionCard";

type Props = {
  open: boolean;
  onClose: () => void;
  tickers: Ticker[];
  portfolioName: string;
  portfolioId: string | null;
};

export function InsightsDrawer({
  open,
  onClose,
  tickers,
  portfolioName,
  portfolioId,
}: Props) {
  const { loading, sections, activeKey, generatedAt, error, regenerate } =
    useInsights({ open, tickers, portfolioName, portfolioId });

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const response = toResponse(sections);
  const allNull =
    !loading &&
    SECTION_KEYS.every((k) => response[k] == null);
  const hasAnyText = SECTION_KEYS.some((k) => sections[k].trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insights-title"
    >
      <button
        type="button"
        aria-label="Close insights"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] dark:bg-slate-950/60"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#0a0e1a]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
              AI insights
            </div>
            <h2
              id="insights-title"
              className="mt-0.5 truncate font-mono text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {portfolioName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && !loading && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </div>
          )}

          {!error && (loading || hasAnyText) && (
            <div className="flex flex-col gap-3">
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
          )}

          {!loading && !error && allNull && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
              Nothing notable to flag. Portfolio looks reasonable on the
              signals reviewed.
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            {generatedAt
              ? `Generated ${formatTime(generatedAt)}`
              : loading
                ? "Streaming…"
                : ""}
          </div>
          <button
            type="button"
            onClick={() => void regenerate(true)}
            disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
          >
            {loading ? "Generating…" : "Regenerate"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
