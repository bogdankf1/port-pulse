import type { Balance, ParsedBalance } from "@/types";

/**
 * Pure domain logic for cash and bank balances. No I/O — the API routes own
 * fetching, and the components own rendering.
 */

/** Names are matched forgivingly — a re-export writing "MonoBank" is the same
 *  account as "monobank". */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A group is "no group" when it is absent or blank, never an empty string. */
export function normalizeGroup(group: string | null | undefined): string | null {
  const trimmed = (group ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The identity of a balance.
 *
 * All three parts are needed. Name alone is not enough: a bank issues one card
 * per currency under a single account name, so "cash" in GBP, CHF, USD and EUR
 * are four separate balances rather than one row written four times. Nor is
 * (name, currency) enough: every bank names its accounts the same way, so
 * "USD card" at Monobank, Privatbank and PUMB are three accounts, not one
 * account listed three times.
 */
export function balanceKey(row: {
  label: string;
  currency: string;
  group?: string | null;
}): string {
  const group = normalizeLabel(normalizeGroup(row.group) ?? "");
  return `${group}\u0000${normalizeLabel(row.label)}\u0000${row.currency.trim().toUpperCase()}`;
}

export type BalanceChange =
  | { kind: "add"; row: ParsedBalance }
  | { kind: "update"; id: string; row: ParsedBalance; from: number; fromCurrency: string }
  | { kind: "unchanged"; id: string; row: ParsedBalance }
  | {
      kind: "remove";
      id: string;
      label: string;
      amount: number;
      currency: string;
      group: string | null;
    };

/**
 * Work out what an upload would do, without doing it.
 *
 * An upload REPLACES the stored set: whatever the file says is the new truth.
 * That is what keeps the data current without any pruning step — close an
 * account and it simply stops appearing in the export, so it stops appearing
 * here. The cost is that a partial export drops every account it omits, which
 * is why removals are part of the plan and shown before anything is written.
 *
 * Matching is by (label, currency) so the preview can say "8,753 → 9,120"
 * rather than "removed, added", which reads as data loss when it is an update.
 * Re-denominating an account does read as remove-plus-add, which is honest:
 * nothing in the file distinguishes that from closing one and opening another.
 */
export function planUpload(
  existing: readonly Balance[],
  parsed: readonly ParsedBalance[],
): BalanceChange[] {
  const byKey = new Map(existing.map((b) => [balanceKey(b), b]));
  const seen = new Set<string>();

  const changes = parsed.map((row): BalanceChange => {
    const key = balanceKey(row);
    seen.add(key);
    const match = byKey.get(key);
    if (!match) return { kind: "add", row };
    if (match.amount === row.amount) {
      return { kind: "unchanged", id: match.id, row };
    }
    return {
      kind: "update",
      id: match.id,
      row,
      from: match.amount,
      fromCurrency: match.currency,
    };
  });

  for (const b of existing) {
    if (seen.has(balanceKey(b))) continue;
    changes.push({
      kind: "remove",
      id: b.id,
      label: b.label,
      amount: b.amount,
      currency: b.currency,
      group: b.group,
    });
  }

  return changes;
}

/** USD value of one balance, or null when its rate is unavailable. */
export function toUsd(
  balance: Pick<Balance, "amount" | "currency">,
  rates: ReadonlyMap<string, number>,
): number | null {
  if (balance.currency === "USD") return balance.amount;
  const rate = rates.get(balance.currency);
  if (rate == null || !Number.isFinite(rate)) return null;
  return balance.amount * rate;
}

export type BalancesTotal = {
  usd: number;
  /** Currencies whose rate could not be fetched, so the total is understated. */
  missing: string[];
};

export function totalUsd(
  balances: readonly Balance[],
  rates: ReadonlyMap<string, number>,
): BalancesTotal {
  let usd = 0;
  const missing = new Set<string>();
  for (const b of balances) {
    const value = toUsd(b, rates);
    // An unconvertible balance is reported as missing rather than counted as
    // zero — a silently understated net worth is worse than an incomplete one.
    if (value == null) missing.add(b.currency);
    else usd += value;
  }
  return { usd, missing: [...missing].sort() };
}

export type BalanceGroup = {
  /** null is the catch-all for accounts the file gave no institution for. */
  name: string | null;
  balances: Balance[];
  usd: number;
  /** Currencies in this group with no rate, so `usd` is understated. */
  missing: string[];
};

/** Whether any account says which institution it belongs to. */
export function hasGroups(balances: readonly Balance[]): boolean {
  return balances.some((b) => normalizeGroup(b.group) != null);
}

/**
 * Balances bucketed by institution, each with its own USD subtotal.
 *
 * Sorted by subtotal, largest first, because the question this answers is
 * "where is my money" — and the answer is more useful in size order than in
 * alphabetical order. Ungrouped accounts sort last regardless of size: they are
 * a leftover bucket, not a bank.
 */
export function groupBalances(
  balances: readonly Balance[],
  rates: ReadonlyMap<string, number>,
): BalanceGroup[] {
  const groups = new Map<string, BalanceGroup>();

  for (const b of balances) {
    const name = normalizeGroup(b.group);
    const key = name ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { name, balances: [], usd: 0, missing: [] };
      groups.set(key, group);
    }
    group.balances.push(b);
    const value = toUsd(b, rates);
    if (value == null) {
      if (!group.missing.includes(b.currency)) group.missing.push(b.currency);
    } else {
      group.usd += value;
    }
  }

  return [...groups.values()].sort((a, b) => {
    if ((a.name == null) !== (b.name == null)) return a.name == null ? 1 : -1;
    return b.usd - a.usd;
  });
}

/** Days since a balance was last true, for the staleness hint in the UI. */
export function ageInDays(asOf: string, now: number = Date.now()): number | null {
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * Accounts that appear more than once with the same group and currency.
 *
 * Two rows with the same identity cannot both be stored, and silently keeping
 * one would drop money from the total without saying so.
 */
export function duplicateKeys(
  rows: readonly ParsedBalance[],
): { label: string; currency: string; group: string | null }[] {
  const seen = new Set<string>();
  const dupes = new Map<string, { label: string; currency: string; group: string | null }>();
  for (const row of rows) {
    const key = balanceKey(row);
    if (seen.has(key)) {
      dupes.set(key, {
        label: row.label,
        currency: row.currency,
        group: normalizeGroup(row.group),
      });
    }
    seen.add(key);
  }
  return [...dupes.values()];
}
