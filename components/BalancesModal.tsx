"use client";

import { useRef, useState } from "react";
import { ModalShell } from "./ModalShell";
import { planUpload, type BalanceChange } from "@/lib/balances";
import { formatCurrency, formatMoney } from "@/lib/format";
import type { Balance, ParsedBalance } from "@/types";

type Props = {
  open: boolean;
  existing: readonly Balance[];
  onClose: () => void;
  onSaved: () => void;
};

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "preview"; rows: ParsedBalance[]; plan: BalanceChange[] }
  | { kind: "saving"; rows: ParsedBalance[]; plan: BalanceChange[] }
  | { kind: "error"; message: string };

export function BalancesModal({ open, existing, onClose, onSaved }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const busy = stage.kind === "parsing" || stage.kind === "saving";

  function close() {
    if (busy) return;
    setStage({ kind: "idle" });
    onClose();
  }

  async function handleFile(file: File) {
    setStage({ kind: "parsing" });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/balances/parse", { method: "POST", body: form });
      const json = (await res.json()) as { rows?: ParsedBalance[]; error?: string };
      if (!res.ok || !json.rows) {
        setStage({ kind: "error", message: json.error ?? "Could not read that file" });
        return;
      }
      // Nothing is written until this preview is confirmed — which is what makes
      // a model-driven parse safe to use on real numbers.
      setStage({
        kind: "preview",
        rows: json.rows,
        plan: planUpload(existing, json.rows),
      });
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not read that file",
      });
    }
  }

  async function save(rows: ParsedBalance[], plan: BalanceChange[]) {
    setStage({ kind: "saving", rows, plan });
    try {
      const res = await fetch("/api/balances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setStage({ kind: "error", message: json.error ?? "Could not save" });
        return;
      }
      onSaved();
      setStage({ kind: "idle" });
      onClose();
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not save",
      });
    }
  }

  return (
    <ModalShell onClose={close} labelledBy="balances-modal-title" disabled={busy}>
      <div className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="balances-modal-title"
            className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Add balances
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Close"
            className="rounded p-1 text-slate-400 transition-colors hover:text-slate-700 disabled:opacity-40 dark:text-slate-500 dark:hover:text-slate-200"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4l8 8M4 12l8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {(stage.kind === "idle" || stage.kind === "error") && (
          <>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
              Upload a CSV with one row per account — a name, an amount, a
              currency, and the bank it sits in if you want them grouped.
              Column names and order don&apos;t matter. The file replaces your
              balances entirely, so include every account. Nothing is saved
              until you confirm.
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 text-center transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:bg-slate-800/50"
            >
              <span className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
                Choose a CSV file
              </span>
              <span className="font-mono text-[10px] text-slate-400 dark:text-slate-600">
                Monobank, USD card, 5267, USD
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFile(file);
              }}
            />
            {stage.kind === "error" && (
              <p className="mt-3 font-mono text-[11px] text-red-600 dark:text-red-400">
                {stage.message}
              </p>
            )}
          </>
        )}

        {stage.kind === "parsing" && (
          <div className="flex min-h-[140px] items-center justify-center font-mono text-[11px] uppercase tracking-widest text-slate-500">
            Reading that file…
          </div>
        )}

        {(stage.kind === "preview" || stage.kind === "saving") && (
          <PreviewTable plan={stage.plan} />
        )}

        {(stage.kind === "preview" || stage.kind === "saving") && (
          <div className="mt-4 flex shrink-0 items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setStage({ kind: "idle" })}
              disabled={busy}
              className="min-h-[36px] rounded-md px-3 text-sm text-slate-600 transition-colors hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Choose another file
            </button>
            <button
              type="button"
              onClick={() => void save(stage.rows, stage.plan)}
              disabled={busy}
              className="min-h-[36px] rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {stage.kind === "saving" ? "Saving…" : "Save balances"}
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function PreviewTable({ plan }: { plan: BalanceChange[] }) {
  const added = plan.filter((c) => c.kind === "add").length;
  const updated = plan.filter((c) => c.kind === "update").length;
  const removed = plan.filter((c) => c.kind === "remove").length;
  const kept = plan.length - removed;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
        {kept} {kept === 1 ? "account" : "accounts"}
        {updated > 0 && ` · ${updated} updated`}
        {added > 0 && ` · ${added} new`}
        {removed > 0 && (
          <span className="text-red-600 dark:text-red-400"> · {removed} removed</span>
        )}
      </div>
      <table className="min-w-full text-sm">
        <tbody>
          {plan.map((change, i) => {
            const label = change.kind === "remove" ? change.label : change.row.label;
            const amount = change.kind === "remove" ? change.amount : change.row.amount;
            const currency =
              change.kind === "remove" ? change.currency : change.row.currency;
            const group =
              change.kind === "remove" ? change.group : change.row.group;
            const gone = change.kind === "remove";
            return (
              <tr
                key={`${group ?? ""}-${label}-${i}`}
                className="border-b border-slate-100 last:border-b-0 dark:border-slate-800/70"
              >
                <td
                  className={`py-2 pr-2 ${gone ? "text-slate-400 line-through dark:text-slate-600" : "text-slate-700 dark:text-slate-200"}`}
                >
                  {group && (
                    <span className="mr-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      {group}
                    </span>
                  )}
                  {label}
                </td>
                <td
                  className={`px-2 py-2 text-right font-mono tabular-nums ${gone ? "text-slate-400 line-through dark:text-slate-600" : "text-slate-900 dark:text-slate-100"}`}
                >
                  {formatCurrency(amount, currency)}
                </td>
                <td className="w-24 py-2 pl-2 text-right font-mono text-[10px] uppercase tracking-widest">
                  {change.kind === "add" && (
                    <span className="text-emerald-600 dark:text-emerald-400">New</span>
                  )}
                  {change.kind === "update" && (
                    <span
                      className="text-slate-500"
                      title={`Was ${formatCurrency(change.from, change.fromCurrency)}`}
                    >
                      {formatMoney(change.from)} →
                    </span>
                  )}
                  {change.kind === "unchanged" && (
                    <span className="text-slate-400 dark:text-slate-600">Same</span>
                  )}
                  {gone && (
                    <span className="text-red-600 dark:text-red-400">Removed</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {removed > 0 && (
        // The whole point of showing this: an upload replaces the stored set,
        // so an export that omits an account deletes it. Saying so before the
        // write is what separates "kept current" from "lost half my accounts".
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
          Saving replaces your balances with exactly this file. The{" "}
          {removed === 1 ? "account" : `${removed} accounts`} struck through
          above {removed === 1 ? "is" : "are"} not in it and will be removed.
        </p>
      )}
    </div>
  );
}
