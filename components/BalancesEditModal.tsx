"use client";

import { useMemo, useState } from "react";
import { ModalShell } from "./ModalShell";
import {
  BALANCE_CURRENCIES,
  duplicateKeys,
  groupBalances,
  parseAmountInput,
  toUsd,
} from "@/lib/balances";
import { formatCurrency, formatMoney } from "@/lib/format";
import type { Balance, ParsedBalance } from "@/types";

type Props = {
  balances: readonly Balance[];
  rates: ReadonlyMap<string, number>;
  onClose: () => void;
  onSaved: () => void;
};

/** An account added in this modal. `group` is an existing group's key or a new bank's id. */
type NewRow = { id: string; group: string; label: string; amount: string; currency: string };
type NewBank = { id: string; name: string };

const existingKey = (name: string | null) => `existing:${name ?? ""}`;

/**
 * Every balance as an editable amount, grouped by bank, saved in one go.
 *
 * Existing accounts only change amount — their names, currencies and banks are
 * their identity. New accounts and new banks can be added alongside; removing
 * one is still the CSV's job. Saving goes through the same replace-everything
 * PUT as an upload, so every row is re-dated to today, which is the point: you
 * have just looked at all of them.
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
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [newBanks, setNewBanks] = useState<NewBank[]>([]);
  // The row "Add account" just created; a new bank's first row leaves focus on the bank name.
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Computed once from the stored amounts, so groups don't reorder while typing.
  const groups = useMemo(() => groupBalances(balances, rates), [balances, rates]);
  const currencies = useMemo(
    () => [...new Set([...BALANCE_CURRENCIES, ...balances.map((b) => b.currency)])],
    [balances],
  );
  const showGroupNames = groups.some((g) => g.name != null) || newBanks.length > 0;

  const parsed = new Map(balances.map((b) => [b.id, parseAmountInput(drafts[b.id] ?? "")]));
  const parsedNew = new Map(newRows.map((r) => [r.id, parseAmountInput(r.amount)]));

  const invalid =
    balances.filter((b) => parsed.get(b.id) == null).length +
    newRows.filter((r) => r.amount.trim() !== "" && parsedNew.get(r.id) == null).length;
  const incomplete =
    newRows.some((r) => r.label.trim() === "" || r.amount.trim() === "") ||
    newBanks.some((b) => b.name.trim() === "");
  const changed = balances.filter((b) => {
    const next = parsed.get(b.id);
    return next != null && next !== b.amount;
  }).length;

  function groupName(key: string): string | null {
    const bank = newBanks.find((b) => b.id === key);
    if (bank) return bank.name.trim() || null;
    return key.slice("existing:".length) || null;
  }

  const rows: ParsedBalance[] = [
    ...balances.map((b) => ({
      label: b.label,
      amount: parsed.get(b.id) ?? b.amount,
      currency: b.currency,
      group: b.group,
    })),
    ...newRows.map((r) => ({
      label: r.label.trim(),
      amount: parsedNew.get(r.id) ?? 0,
      currency: r.currency,
      group: groupName(r.group),
    })),
  ];
  const dupes = incomplete ? [] : duplicateKeys(rows);

  let oldUsd = 0;
  let newUsd = 0;
  const unpriced = new Set<string>();
  for (const b of balances) oldUsd += toUsd(b, rates) ?? 0;
  for (const r of rows) {
    const usd = toUsd(r, rates);
    if (usd == null) unpriced.add(r.currency);
    else newUsd += usd;
  }
  const delta = newUsd - oldUsd;

  const problem =
    error ??
    (invalid > 0
      ? `${invalid === 1 ? "One amount isn't" : `${invalid} amounts aren't`} a number.`
      : dupes.length > 0
        ? `${dupes.map((d) => `${d.group ? `${d.group} · ` : ""}${d.label} (${d.currency})`).join(", ")} is listed twice.`
        : null);

  function addRow(group: string) {
    // A bank's next card is most likely in a currency it already holds.
    const first =
      newRows.find((r) => r.group === group)?.currency ??
      groups.find((g) => existingKey(g.name) === group)?.balances[0]?.currency ??
      balances[0]?.currency ??
      "USD";
    const id = crypto.randomUUID();
    setFocusRow(id);
    setNewRows((prev) => [...prev, { id, group, label: "", amount: "", currency: first }]);
  }

  function addBank() {
    const id = crypto.randomUUID();
    setNewBanks((prev) => [...prev, { id, name: "" }]);
    setNewRows((prev) => [
      ...prev,
      { id: crypto.randomUUID(), group: id, label: "", amount: "", currency: balances[0]?.currency ?? "USD" },
    ]);
  }

  function updateRow(id: string, patch: Partial<NewRow>) {
    setNewRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(row: NewRow) {
    const rest = newRows.filter((r) => r.id !== row.id);
    setNewRows(rest);
    // A new bank lives only as long as it has an account in it.
    if (!rest.some((r) => r.group === row.group)) {
      setNewBanks((prev) => prev.filter((b) => b.id !== row.group));
    }
  }

  function removeBank(id: string) {
    setNewBanks((prev) => prev.filter((b) => b.id !== id));
    setNewRows((prev) => prev.filter((r) => r.group !== id));
  }

  async function save() {
    if (invalid > 0 || incomplete || dupes.length > 0) return;
    setSaving(true);
    setError(null);
    try {
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

  const accounts = balances.length + newRows.length;

  const newRowsOf = (group: string) =>
    newRows
      .filter((r) => r.group === group)
      .map((r) => (
        <NewAccountRow
          key={r.id}
          row={r}
          parsed={parsedNew.get(r.id) ?? null}
          autoFocus={r.id === focusRow}
          currencies={currencies}
          disabled={saving}
          onChange={(patch) => updateRow(r.id, patch)}
          onRemove={() => removeRow(r)}
        />
      ));

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
              {accounts} {accounts === 1 ? "account" : "accounts"}
              {changed > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400"> · {changed} changed</span>
              )}
              {newRows.length > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400"> · {newRows.length} new</span>
              )}
            </p>
          </div>
          <CloseButton onClick={onClose} disabled={saving} label="Close" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {groups.map((group) => (
            <div key={group.name ?? ""} role="group" aria-label={group.name ?? "Other"}>
              {showGroupNames && (
                <div className={GROUP_HEADER}>{group.name ?? "Other"}</div>
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
              {newRowsOf(existingKey(group.name))}
              <AddButton onClick={() => addRow(existingKey(group.name))} disabled={saving}>
                Add account
              </AddButton>
            </div>
          ))}

          {newBanks.map((bank) => (
            <div key={bank.id} role="group" aria-label={bank.name || "New bank"}>
              <div className={`${GROUP_HEADER} flex items-center gap-2 py-1.5`}>
                <input
                  type="text"
                  autoFocus
                  autoComplete="off"
                  placeholder="Bank name"
                  aria-label="Bank name"
                  value={bank.name}
                  disabled={saving}
                  maxLength={60}
                  onChange={(e) =>
                    setNewBanks((prev) =>
                      prev.map((b) => (b.id === bank.id ? { ...b, name: e.target.value } : b)),
                    )
                  }
                  className="min-w-0 flex-1 bg-transparent py-1 text-base uppercase tracking-widest text-slate-700 outline-none placeholder:text-slate-400 disabled:opacity-50 dark:text-slate-200 dark:placeholder:text-slate-600 sm:text-[10px]"
                />
                <CloseButton onClick={() => removeBank(bank.id)} disabled={saving} label="Remove bank" />
              </div>
              {newRowsOf(bank.id)}
              <AddButton onClick={() => addRow(bank.id)} disabled={saving}>
                Add account
              </AddButton>
            </div>
          ))}

          <div className="border-t border-slate-100 dark:border-slate-800">
            <AddButton onClick={addBank} disabled={saving}>
              Add bank
            </AddButton>
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
              Total
              {unpriced.size > 0 && (
                <span className="ml-2 font-normal normal-case tracking-normal text-amber-600 dark:text-amber-400">
                  excl. {[...unpriced].sort().join(", ")}
                </span>
              )}
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

          {problem ? (
            <p role="alert" className="mt-2 font-mono text-[11px] text-red-600 dark:text-red-400">
              {problem}
            </p>
          ) : (
            incomplete && (
              <p className="mt-2 font-mono text-[11px] text-slate-500">
                Give each new bank and account a name and an amount.
              </p>
            )
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
              disabled={saving || invalid > 0 || incomplete || dupes.length > 0}
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

const GROUP_HEADER =
  "sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-widest text-slate-600 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-400 sm:px-5";

const ROW = "flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800/70 sm:px-5";

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
    <div className={ROW}>
      <label htmlFor={inputId} className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-700 dark:text-slate-200">
          {balance.label}
        </span>
        <span className="block truncate font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {/* A blank line rather than none, so a row doesn't grow on its first edit. */}
          {isChanged ? `was ${formatCurrency(balance.amount, balance.currency)}` : " "}
        </span>
      </label>
      <AmountField
        id={inputId}
        value={value}
        tone={isInvalid ? "invalid" : isChanged ? "changed" : "idle"}
        disabled={disabled}
        onChange={onChange}
      >
        <span className="shrink-0 pl-1.5 pr-2.5 font-mono text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500">
          {balance.currency}
        </span>
      </AmountField>
    </div>
  );
}

/** An account added in this modal: its name and currency are editable too. */
function NewAccountRow({
  row,
  parsed,
  autoFocus,
  currencies,
  disabled,
  onChange,
  onRemove,
}: {
  row: NewRow;
  parsed: number | null;
  autoFocus: boolean;
  currencies: readonly string[];
  disabled: boolean;
  onChange: (patch: Partial<NewRow>) => void;
  onRemove: () => void;
}) {
  // Blank is "not filled in yet", not wrong — only a typed non-number is red.
  const isInvalid = row.amount.trim() !== "" && parsed == null;

  return (
    <div className={ROW}>
      <input
        type="text"
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder="Account name"
        aria-label="Account name"
        value={row.label}
        disabled={disabled}
        maxLength={80}
        onChange={(e) => onChange({ label: e.target.value })}
        className="min-h-[40px] min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-base text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:placeholder:text-slate-600 dark:focus:border-slate-500 sm:min-h-[34px] sm:text-sm"
      />
      <AmountField
        id={`balance-amount-${row.id}`}
        label="Amount"
        value={row.amount}
        tone={isInvalid ? "invalid" : parsed != null ? "changed" : "idle"}
        disabled={disabled}
        onChange={(amount) => onChange({ amount })}
      >
        <select
          aria-label="Currency"
          value={row.currency}
          disabled={disabled}
          onChange={(e) => onChange({ currency: e.target.value })}
          // 16px on phones for the same iOS zoom reason as the amount input.
          className="shrink-0 cursor-pointer appearance-none bg-transparent pl-1.5 pr-2.5 font-mono text-base uppercase text-slate-500 outline-none disabled:opacity-50 dark:text-slate-400 sm:text-[10px] sm:tracking-widest"
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </AmountField>
      <CloseButton onClick={onRemove} disabled={disabled} label="Remove account" />
    </div>
  );
}

function AmountField({
  id,
  label,
  value,
  tone,
  disabled,
  onChange,
  children,
}: {
  id: string;
  label?: string;
  value: string;
  tone: "idle" | "changed" | "invalid";
  disabled: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex w-40 shrink-0 items-center rounded-md border bg-white transition-colors focus-within:ring-2 dark:bg-slate-950/60 sm:w-48 ${
        tone === "invalid"
          ? "border-red-400 focus-within:ring-red-500/30 dark:border-red-500/70"
          : tone === "changed"
            ? "border-emerald-500/60 focus-within:ring-emerald-500/30"
            : "border-slate-200 focus-within:border-slate-400 focus-within:ring-slate-400/20 dark:border-slate-700 dark:focus-within:border-slate-500"
      }`}
    >
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={label ? "0" : undefined}
        aria-label={label}
        value={value}
        disabled={disabled}
        aria-invalid={tone === "invalid"}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        // 16px on phones: anything smaller makes iOS Safari zoom the page on focus.
        className="min-h-[40px] w-full min-w-0 bg-transparent py-1.5 pl-2.5 text-right font-mono text-base tabular-nums text-slate-900 outline-none placeholder:text-slate-300 disabled:opacity-50 dark:text-slate-100 dark:placeholder:text-slate-600 sm:min-h-[34px] sm:text-sm"
      />
      {children}
    </div>
  );
}

function AddButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-1.5 border-b border-slate-100 px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-slate-500 transition-colors last:border-b-0 hover:text-slate-900 disabled:opacity-40 dark:border-slate-800/70 dark:hover:text-slate-100 sm:px-5"
    >
      <span aria-hidden>+</span>
      {children}
    </button>
  );
}

function CloseButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:text-slate-700 disabled:opacity-40 dark:text-slate-500 dark:hover:text-slate-200"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 4l8 8M4 12l8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
