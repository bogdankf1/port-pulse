export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function formatCompactMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function plColor(n: number): string {
  return n >= 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

export function signed(n: number, format: (v: number) => string): string {
  return `${n >= 0 ? "+" : "−"}${format(Math.abs(n))}`;
}

/**
 * An amount in its own currency, with that currency's sign — "$5,267.00",
 * "€4,993.00", "£500.00".
 *
 * `narrowSymbol` is what keeps USD as "$" rather than "US$"; a currency with no
 * symbol in this locale (CHF, PLN) falls back to its code, which is the only
 * honest rendering. Fraction digits are left to the currency rather than forced
 * to two, so a zero-decimal currency is not shown with cents it does not have.
 */
export function formatCurrency(amount: number, currency: string): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  });
}
