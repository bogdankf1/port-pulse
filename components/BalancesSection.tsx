"use client";

import { useId, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import {
  ageInDays,
  groupBalances,
  hasGroups,
  toUsd,
  type BalanceGroup,
} from "@/lib/balances";
import { formatCurrency, formatMoney } from "@/lib/format";
import type { Balance } from "@/types";

type Props = {
  balances: readonly Balance[];
  rates: Record<string, number>;
  totalUsd: number;
  missingRates: readonly string[];
  onChanged: () => void;
};

/**
 * Cash and bank balances, below the positions.
 *
 * Deliberately its own section rather than rows in the holdings table: a
 * balance has no entry price, no day change and no P&L, so it would be four
 * empty columns and would break sorting.
 */
export function BalancesSection({
  balances,
  rates,
  totalUsd,
  missingRates,
  onChanged,
}: Props) {
  const [clearOpen, setClearOpen] = useState(false);
  // Collapsed rather than expanded is what is tracked, so a group added by a
  // later upload arrives open like every other one.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rateMap = new Map(Object.entries(rates));

  if (balances.length === 0) return null;

  // One timestamp for the section: every row is written by the same upload, so
  // per-row dates would be the same number repeated.
  const oldest = balances.reduce<number | null>((acc, b) => {
    const age = ageInDays(b.asOf);
    if (age == null) return acc;
    return acc == null ? age : Math.max(acc, age);
  }, null);

  // A file that names no institution keeps the plain list it had before —
  // one collapsible group holding everything would be ceremony around nothing.
  const grouped = hasGroups(balances);
  const groups = groupBalances(balances, rateMap);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  return (
    <section className="border-t border-slate-200 dark:border-slate-800/70 sm:mt-5 sm:rounded-xl sm:border sm:bg-white/60 sm:p-5 sm:dark:bg-slate-900/40">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4 sm:px-0 sm:pt-0">
        <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Balances
          {oldest != null && (
            // Prices refresh themselves; an uploaded balance never does. Saying
            // how old it is keeps a stale number from passing as a live one.
            <span className="ml-2 normal-case tracking-normal text-slate-400 dark:text-slate-600">
              {oldest === 0 ? "as of today" : `as of ${oldest}d ago`}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setClearOpen(true)}
          className="font-mono text-[10px] uppercase tracking-widest text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-slate-100"
        >
          Remove
        </button>
      </div>

      <div className="mt-2 sm:mt-3">
        {grouped
          ? groups.map((group) => (
              <BalanceGroupRows
                key={group.name ?? ""}
                group={group}
                rates={rateMap}
                sectionUsd={totalUsd}
                open={!collapsed.has(group.name ?? "")}
                onToggle={() => toggle(group.name ?? "")}
              />
            ))
          : balances.map((b) => (
              <BalanceRow key={b.id} balance={b} rates={rateMap} />
            ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t-2 border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/60 sm:mt-3 sm:rounded-md sm:px-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
          Balances total
        </span>
        <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
          ${formatMoney(totalUsd)}
        </span>
      </div>

      {missingRates.length > 0 && (
        <p className="px-4 pb-3 pt-2 font-mono text-[10px] text-amber-600 dark:text-amber-400 sm:px-0">
          No exchange rate for {missingRates.join(", ")} — those accounts are not
          in the total.
        </p>
      )}

      <ConfirmModal
        open={clearOpen}
        title="Remove balances"
        body="This deletes every uploaded balance. Your positions are not affected, and you can upload the file again."
        confirmLabel="Remove"
        busyLabel="Removing…"
        destructive
        onConfirm={async () => {
          try {
            await fetch("/api/balances", { method: "DELETE" });
            onChanged();
          } finally {
            setClearOpen(false);
          }
        }}
        onCancel={() => setClearOpen(false)}
      />
    </section>
  );
}

/**
 * One bank, its accounts, and what it holds in total.
 *
 * The header carries the subtotal whether or not the group is open — the
 * question "how much is at this bank" is the reason to group at all, so
 * collapsing must not take the answer away with the rows.
 */
function BalanceGroupRows({
  group,
  rates,
  sectionUsd,
  open,
  onToggle,
}: {
  group: BalanceGroup;
  rates: ReadonlyMap<string, number>;
  sectionUsd: number;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `balances-group-${useId().replace(/:/g, "")}`;
  const share = sectionUsd > 0 ? (group.usd / sectionUsd) * 100 : 0;

  return (
    <div className="border-b border-slate-100 last:border-b-0 dark:border-slate-800/70">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 sm:px-2"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          aria-hidden
          className={`shrink-0 text-slate-400 transition-transform duration-150 dark:text-slate-500 ${open ? "rotate-90" : ""}`}
        >
          <path
            d="M2.5 1L6 4L2.5 7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium uppercase tracking-widest text-slate-700 dark:text-slate-300">
          {group.name ?? "Other"}
          <span className="ml-2 font-sans text-[11px] normal-case tracking-normal text-slate-400 dark:text-slate-500">
            {group.balances.length}
          </span>
        </span>
        <span className="shrink-0 text-right font-mono tabular-nums">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            ${formatMoney(group.usd)}
          </span>
          {sectionUsd > 0 && (
            <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
              {share.toFixed(0)}%
            </span>
          )}
        </span>
      </button>

      {open && (
        <div id={panelId} className="pb-1">
          {group.balances.map((b) => (
            <BalanceRow key={b.id} balance={b} rates={rates} indented />
          ))}
        </div>
      )}
    </div>
  );
}

function BalanceRow({
  balance,
  rates,
  indented = false,
}: {
  balance: Balance;
  rates: ReadonlyMap<string, number>;
  indented?: boolean;
}) {
  const usd = toUsd(balance, rates);
  return (
    <div
      className={
        indented
          ? "flex items-baseline justify-between gap-3 py-1.5 pl-10 pr-4 sm:pl-8 sm:pr-2"
          : "flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0 dark:border-slate-800/70 sm:px-0"
      }
    >
      <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
        {balance.label}
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100">
          {formatCurrency(balance.amount, balance.currency)}
        </span>
        {balance.currency !== "USD" && (
          <span className="block font-mono text-[11px] tabular-nums text-slate-500">
            {usd != null ? `$${formatMoney(usd)}` : "rate unavailable"}
          </span>
        )}
      </span>
    </div>
  );
}
