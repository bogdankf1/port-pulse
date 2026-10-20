"use client";

import { useMemo, useState } from "react";
import { ModalShell } from "./ModalShell";
import { groupBalances, parseAmountInput, toUsd } from "@/lib/balances";
import { formatCurrency, formatMoney } from "@/lib/format";
import type { Balance } from "@/types";

type Props = {
  balances: readonly Balance[];
  rates: ReadonlyMap<string, number>;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Every balance as an editable amount, grouped by bank, saved in one go.
 *
 * Only amounts change here — names, currencies and banks come from the upload,
 * and adding or dropping an account is still the CSV's job. Saving goes through
 * the same replace-everything PUT as an upload, so every row is re-dated to
 * today, which is the point: you have just looked at all of them.
 *
 * Mount it only while open, so each opening starts from the stored values.
 */
export function BalancesEditModal({ balances, rates, onClose, onSaved }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      balances.map((b) => [
        b.id,
        b.amount.toLocaleString("en-US", { maximumFractionDigits: 8 }),
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Computed once from the stored amounts, so groups don't reorder while typing.
  const groups = useMemo(() => groupBalances(balances, rates), [balances, rates]);
  const showGroupNames = groups.some((g) => g.name != null);

  const parsed = new Map(balances.map((b) => [b.id, parseAmountInput(drafts[b.id] ?? "")]));
  const invalid = balances.filter((b) => parsed.get(b.id) == null).length;
  const changed = balances.filter((b) => {
    const next = parsed.get(b.id);
    return next != null && next !== b.amount;
  }).length;

  let oldUsd = 0;
  let newUsd = 0;
  for (const b of balances) {
    oldUsd += toUsd(b, rates) ?? 0;
    newUsd += toUsd({ amount: parsed.get(b.id) ?? b.amount, currency: b.currency }, rates) ?? 0;
  }
  const delta = newUsd - oldUsd;

  async function save() {
    if (invalid > 0) return;
    setSaving(true);
    setError(null);
    try {
      const rows = balances.map((b) => ({
        label: b.label,
        amount: parsed.get(b.id) ?? b.amount,
        currency: b.currency,
        group: b.group,
      }));
      const res = await fetch("/api/balances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Could not save");
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} labelledBy="balances-edit-title" disabled={saving}>
      <div className="relative flex max-h-[90dvh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-5">
          <div>
            <h2
              id="balances-edit-title"
              className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Edit balances
            </h2>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              {balances.length} {balances.length === 1 ? "account" : "accounts"}
              {changed > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400"> · {changed} changed</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded p-1 text-slate-400 transition-colors hover:text-slate-700 disabled:opacity-40 dark:text-slate-500 dark:hover:text-slate-200"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4l8 8M4 12l8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {groups.map((group) => (
            <div key={group.name ?? ""} role="group" aria-label={group.name ?? "Other"}>
              {showGroupNames && (
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-widest text-slate-600 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-400 sm:px-5">
                  {group.name ?? "Other"}
                </div>
              )}
              {group.balances.map((b) => (
                <AmountRow
                  key={b.id}
                  balance={b}
                  value={drafts[b.id] ?? ""}
                  parsed={parsed.get(b.id) ?? null}
                  disabled={saving}
                  onChange={(value) => setDrafts((prev) => ({ ...prev, [b.id]: value }))}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
              Total
            </span>
            <span className="text-right font-mono tabular-nums">
              {Math.abs(delta) >= 0.005 && (
                <span
                  className={`mr-2 text-[11px] ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                >
                  {delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))}
                </span>
              )}
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                ${formatMoney(newUsd)}
              </span>
            </span>
          </div>

          {(error || invalid > 0) && (
            <p role="alert" className="mt-2 font-mono text-[11px] text-red-600 dark:text-red-400">
              {error ??
                `${invalid === 1 ? "One amount isn't" : `${invalid} amounts aren't`} a number.`}
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="min-h-[44px] rounded-md border border-slate-200 px-3 text-sm text-slate-600 transition-colors hover:text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100 sm:min-h-[36px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || invalid > 0}
              className="min-h-[44px] rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white sm:min-h-[36px]"
            >
              {saving ? "Saving…" : "Save balances"}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function AmountRow({
  balance,
  value,
  parsed,
  disabled,
  onChange,
}: {
  balance: Balance;
  value: string;
  parsed: number | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const inputId = `balance-amount-${balance.id}`;
  const isInvalid = parsed == null;
  const isChanged = !isInvalid && parsed !== balance.amount;

  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0 dark:border-slate-800/70 sm:px-5">
      <label htmlFor={inputId} className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-700 dark:text-slate-200">
          {balance.label}
        </span>
        <span className="block truncate font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {/* A blank line rather than none, so a row doesn't grow on its first edit. */}
          {isChanged ? `was ${formatCurrency(balance.amount, balance.currency)}` : " "}
        </span>
      </label>
      <div
        className={`flex w-40 shrink-0 items-center rounded-md border bg-white transition-colors focus-within:ring-2 dark:bg-slate-950/60 sm:w-48 ${
          isInvalid
            ? "border-red-400 focus-within:ring-red-500/30 dark:border-red-500/70"
            : isChanged
              ? "border-emerald-500/60 focus-within:ring-emerald-500/30"
              : "border-slate-200 focus-within:border-slate-400 focus-within:ring-slate-400/20 dark:border-slate-700 dark:focus-within:border-slate-500"
        }`}
      >
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={disabled}
          aria-invalid={isInvalid}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          // 16px on phones: anything smaller makes iOS Safari zoom the page on focus.
          className="min-h-[40px] w-full min-w-0 bg-transparent py-1.5 pl-2.5 text-right font-mono text-base tabular-nums text-slate-900 outline-none disabled:opacity-50 dark:text-slate-100 sm:min-h-[34px] sm:text-sm"
        />
        <span className="shrink-0 pl-1.5 pr-2.5 font-mono text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500">
          {balance.currency}
        </span>
      </div>
    </div>
  );
}
