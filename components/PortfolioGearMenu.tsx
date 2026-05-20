"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getActiveIdServerSnapshot,
  getActivePortfolioId,
  getPortfolios,
  getPortfoliosServerSnapshot,
  subscribeActivePortfolio,
  subscribePortfolios,
} from "@/lib/portfolios";
import {
  PortfolioModal,
  type PortfolioModalState,
} from "./PortfolioModal";

export function PortfolioGearMenu() {
  const portfolios = useSyncExternalStore(
    subscribePortfolios,
    getPortfolios,
    getPortfoliosServerSnapshot,
  );
  const activeId = useSyncExternalStore(
    subscribeActivePortfolio,
    getActivePortfolioId,
    getActiveIdServerSnapshot,
  );

  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<PortfolioModalState>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (portfolios.length === 0) return null;

  const active = portfolios.find((p) => p.id === activeId) ?? portfolios[0];
  if (!active) return null;

  const canDelete = portfolios.length > 1;

  function openRename() {
    setOpen(false);
    setModal({ kind: "rename", portfolio: active });
  }

  function openDelete() {
    setOpen(false);
    if (!canDelete) return;
    setModal({ kind: "delete", portfolio: active });
  }

  return (
    <>
      <div ref={wrapperRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Portfolio settings"
          title="Portfolio settings"
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-slate-300 text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
        >
          <GearIcon />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 z-30 mt-1.5 w-48 origin-top-right rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              {active.name}
            </div>
            <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
            <button
              type="button"
              role="menuitem"
              onClick={openRename}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Rename portfolio
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={openDelete}
              disabled={!canDelete}
              title={
                canDelete ? undefined : "You need at least one portfolio."
              }
              className="block w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10 dark:disabled:text-slate-600 dark:disabled:hover:bg-transparent"
            >
              Delete portfolio
            </button>
          </div>
        )}
      </div>
      <PortfolioModal state={modal} onClose={() => setModal(null)} />
    </>
  );
}

function GearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
