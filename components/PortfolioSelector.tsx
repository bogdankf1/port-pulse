"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getActiveIdServerSnapshot,
  getActivePortfolioId,
  getPortfolios,
  getPortfoliosServerSnapshot,
  setActivePortfolio,
  subscribeActivePortfolio,
  subscribePortfolios,
} from "@/lib/portfolios";
import {
  PortfolioModal,
  type PortfolioModalState,
} from "./PortfolioModal";

export function PortfolioSelector() {
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

  function openCreate() {
    setOpen(false);
    setModal({ kind: "create" });
  }

  return (
    <>
      <div ref={wrapperRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white/70 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="font-mono">{active?.name ?? "Portfolio"}</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path
              d="M2 4l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {open && (
          <div
            role="menu"
            className="absolute left-0 z-30 mt-1.5 w-56 origin-top-left rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="max-h-64 overflow-y-auto py-0.5">
              {portfolios.map((p) => (
                <button
                  key={p.id}
                  role="menuitemradio"
                  aria-checked={p.id === activeId}
                  onClick={() => {
                    setActivePortfolio(p.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                    p.id === activeId
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`text-emerald-600 dark:text-emerald-400 ${p.id === activeId ? "opacity-100" : "opacity-0"}`}
                  >
                    ✓
                  </span>
                  <span className="truncate font-mono">{p.name}</span>
                </button>
              ))}
            </div>
            <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
            <button
              type="button"
              onClick={openCreate}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              + New portfolio
            </button>
          </div>
        )}
      </div>
      <PortfolioModal state={modal} onClose={() => setModal(null)} />
    </>
  );
}
