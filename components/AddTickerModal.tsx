"use client";

import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ForwardedRef,
} from "react";
import { mergeIntoWatchlist } from "@/lib/storage";
import { isValidSymbol, useTickerSearch, type SearchResult } from "@/lib/search";
import type { Ticker } from "@/types";

type Props = {
  open: boolean;
  onClose: () => void;
  activePortfolioName?: string;
};

export function AddTickerModal({ open, onClose, activePortfolioName }: Props) {
  if (!open) return null;
  return <Inner onClose={onClose} activePortfolioName={activePortfolioName} />;
}

function Inner({
  onClose,
  activePortfolioName,
}: {
  onClose: () => void;
  activePortfolioName?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [quantity, setQuantity] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const searchState = useTickerSearch(selected ? "" : query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (selected) {
      qtyRef.current?.focus();
    }
  }, [selected]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const submitLabel = useMemo(() => {
    if (activePortfolioName) return `Add to ${activePortfolioName}`;
    return "Add to portfolio";
  }, [activePortfolioName]);

  function handleSelect(result: SearchResult) {
    setSelected(result);
    setError(null);
  }

  function handleClear() {
    setSelected(null);
    setQuantity("");
    setEntryPrice("");
    setError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (!isValidSymbol(selected.symbol)) {
      setError("That symbol isn't supported yet.");
      return;
    }
    const qty = parsePositiveOptional(quantity);
    if (qty === "invalid") {
      setError("Quantity must be a positive number.");
      return;
    }
    const entry = parsePositiveOptional(entryPrice);
    if (entry === "invalid") {
      setError("Entry price must be a positive number.");
      return;
    }
    const ticker: Ticker = {
      symbol: selected.symbol,
      name: selected.description || selected.symbol,
      ...(typeof qty === "number" ? { quantity: qty } : {}),
      ...(typeof entry === "number" ? { entryPrice: entry } : {}),
    };
    mergeIntoWatchlist([ticker]);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-ticker-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="add-ticker-title"
            className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Add ticker
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 transition-colors hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M4 4l8 8M4 12l8-8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {!selected ? (
          <>
            <label
              htmlFor="add-ticker-search"
              className="font-mono text-[10px] uppercase tracking-widest text-slate-500"
            >
              Search symbol or company
            </label>
            <input
              id="add-ticker-search"
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="AAPL, Apple, NVDA…"
              autoComplete="off"
              className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-400"
            />

            <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white/40 dark:border-slate-800 dark:bg-slate-900/40">
              <SearchResultsList
                state={searchState}
                onSelect={handleSelect}
              />
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {selected.symbol}
                </div>
                {selected.description && (
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {selected.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleClear}
                className="font-mono text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Change
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <NumberField
                ref={qtyRef}
                id="add-ticker-qty"
                label="Quantity"
                value={quantity}
                onChange={setQuantity}
                placeholder="e.g. 10"
              />
              <NumberField
                id="add-ticker-entry"
                label="Entry price"
                value={entryPrice}
                onChange={setEntryPrice}
                placeholder="e.g. 180.25"
              />
            </div>

            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-500">
              Both are optional. Add them to unlock per-row P&L.
            </p>

            {error && (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
              >
                {submitLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SearchResultsList({
  state,
  onSelect,
}: {
  state: ReturnType<typeof useTickerSearch>;
  onSelect: (r: SearchResult) => void;
}) {
  if (state.status === "idle") {
    return (
      <div className="px-3 py-6 text-center font-mono text-[11px] text-slate-500 dark:text-slate-500">
        Start typing to search…
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="px-3 py-6 text-center font-mono text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-600">
        Searching…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="px-3 py-6 text-center font-mono text-[11px] text-red-600 dark:text-red-400">
        {state.message}
      </div>
    );
  }
  if (state.results.length === 0) {
    return (
      <div className="px-3 py-6 text-center font-mono text-[11px] text-slate-500 dark:text-slate-500">
        No matches for &ldquo;{state.query}&rdquo;.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
      {state.results.map((r) => (
        <li key={r.symbol}>
          <button
            type="button"
            onClick={() => onSelect(r)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
          >
            <div className="min-w-0">
              <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                {r.symbol}
              </div>
              {r.description && (
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {r.description}
                </div>
              )}
            </div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-600">
              Add
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type NumberFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

const NumberField = forwardRef(function NumberField(
  { id, label, value, onChange, placeholder }: NumberFieldProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono text-[10px] uppercase tracking-widest text-slate-500"
      >
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-400"
      />
    </div>
  );
});

function parsePositiveOptional(raw: string): number | undefined | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return "invalid";
  return n;
}
