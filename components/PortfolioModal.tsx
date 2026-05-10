"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  createPortfolio,
  deletePortfolio,
  renamePortfolio,
} from "@/lib/portfolios";
import type { Portfolio } from "@/types";

export type PortfolioModalState =
  | null
  | { kind: "create" }
  | { kind: "rename"; portfolio: Portfolio }
  | { kind: "delete"; portfolio: Portfolio };

type Props = {
  state: PortfolioModalState;
  onClose: () => void;
};

export function PortfolioModal({ state, onClose }: Props) {
  if (!state) return null;
  return <ModalImpl state={state} onClose={onClose} />;
}

function ModalImpl({
  state,
  onClose,
}: {
  state: NonNullable<PortfolioModalState>;
  onClose: () => void;
}) {
  const isText = state.kind !== "delete";
  const initialName = state.kind === "rename" ? state.portfolio.name : "";
  const [value, setValue] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isText) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      cancelRef.current?.focus();
    }
  }, [isText]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!busy) onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [busy, onClose]);

  async function handleSubmit(e?: FormEvent) {
    if (e) e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (state.kind === "create") {
        const trimmed = value.trim();
        const created = await createPortfolio(trimmed || undefined);
        if (!created) {
          setError("Could not create portfolio. Try again.");
          return;
        }
      } else if (state.kind === "rename") {
        const trimmed = value.trim();
        if (!trimmed) {
          setError("Name can't be empty.");
          return;
        }
        if (trimmed === state.portfolio.name) {
          onClose();
          return;
        }
        const ok = await renamePortfolio(state.portfolio.id, trimmed);
        if (!ok) {
          setError("Could not rename. Try again.");
          return;
        }
      } else if (state.kind === "delete") {
        const ok = await deletePortfolio(state.portfolio.id);
        if (!ok) {
          setError("Could not delete. Try again.");
          return;
        }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const meta = metaFor(state);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portfolio-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
        onClick={() => {
          if (!busy) onClose();
        }}
        tabIndex={-1}
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <h2
          id="portfolio-modal-title"
          className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          {meta.title}
        </h2>
        {meta.body && (
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            {meta.body}
          </p>
        )}

        {isText && (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={state.kind === "create" ? "e.g. Roth IRA" : ""}
            maxLength={60}
            disabled={busy}
            className="mt-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-400"
          />
        )}

        {error && (
          <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 disabled:opacity-60 dark:text-slate-400 dark:hover:text-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60 ${meta.actionClass}`}
          >
            {busy ? meta.busyLabel : meta.actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function metaFor(state: NonNullable<PortfolioModalState>): {
  title: string;
  body: ReactNode;
  actionLabel: string;
  busyLabel: string;
  actionClass: string;
} {
  switch (state.kind) {
    case "create":
      return {
        title: "New portfolio",
        body: "Give it a name. You can leave this blank to auto-name it.",
        actionLabel: "Create",
        busyLabel: "Creating…",
        actionClass:
          "bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400",
      };
    case "rename":
      return {
        title: "Rename portfolio",
        body: (
          <>
            Renaming{" "}
            <span className="font-mono text-slate-900 dark:text-slate-100">
              {state.portfolio.name}
            </span>
            .
          </>
        ),
        actionLabel: "Save",
        busyLabel: "Saving…",
        actionClass:
          "bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400",
      };
    case "delete":
      return {
        title: "Delete portfolio",
        body: (
          <>
            Delete{" "}
            <span className="font-mono text-slate-900 dark:text-slate-100">
              {state.portfolio.name}
            </span>{" "}
            and all its tickers? This can&apos;t be undone.
          </>
        ),
        actionLabel: "Delete",
        busyLabel: "Deleting…",
        actionClass:
          "bg-red-600 hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400",
      };
  }
}
