import { describe, expect, it } from "vitest";
import {
  ageInDays,
  balanceKey,
  duplicateKeys,
  normalizeLabel,
  planUpload,
  totalUsd,
  toUsd,
} from "./balances";
import type { Balance } from "@/types";

const RATES = new Map([
  ["EUR", 1.16],
  ["UAH", 0.0224],
]);

function bal(over: Partial<Balance> = {}): Balance {
  return {
    id: "b1",
    label: "Monobank",
    amount: 8753,
    currency: "EUR",
    asOf: "2026-08-19T00:00:00.000Z",
    ...over,
  };
}

describe("normalizeLabel", () => {
  it("matches forgivingly on case and spacing", () => {
    expect(normalizeLabel("  MonoBank   Black ")).toBe("monobank black");
  });
});

describe("planUpload", () => {
  it("adds a label that is not held yet", () => {
    expect(planUpload([], [{ label: "Cash", amount: 1000, currency: "USD" }])).toEqual([
      { kind: "add", row: { label: "Cash", amount: 1000, currency: "USD" } },
    ]);
  });

  it("updates a matching label rather than appending a duplicate", () => {
    // Appending is what would silently double an account inside net worth.
    const plan = planUpload(
      [bal()],
      [{ label: "monobank", amount: 9120, currency: "EUR" }],
    );
    expect(plan).toEqual([
      {
        kind: "update",
        id: "b1",
        row: { label: "monobank", amount: 9120, currency: "EUR" },
        from: 8753,
        fromCurrency: "EUR",
      },
    ]);
  });

  it("reports an identical row as unchanged", () => {
    const plan = planUpload([bal()], [{ label: "Monobank", amount: 8753, currency: "EUR" }]);
    expect(plan[0].kind).toBe("unchanged");
  });

  it("treats a currency switch on the same label as a different account", () => {
    // Nothing in a file distinguishes re-denominating an account from closing
    // one and opening another, so this reads as remove-plus-add rather than
    // silently rewriting the currency of a stored balance.
    const plan = planUpload([bal()], [{ label: "Monobank", amount: 8753, currency: "USD" }]);
    expect(plan.map((c) => c.kind).sort()).toEqual(["add", "remove"]);
  });

  it("keeps same-name accounts in different currencies apart", () => {
    // The real shape that broke this: one bank, one card per currency.
    const existing = [
      bal({ id: "c1", label: "cash", amount: 500, currency: "GBP" }),
      bal({ id: "c2", label: "cash", amount: 1316, currency: "USD" }),
      bal({ id: "c3", label: "cash", amount: 3950, currency: "EUR" }),
    ];
    const plan = planUpload(existing, [
      { label: "cash", amount: 500, currency: "GBP" },
      { label: "cash", amount: 1400, currency: "USD" },
      { label: "cash", amount: 3950, currency: "EUR" },
      { label: "cash", amount: 500, currency: "CHF" },
    ]);
    expect(plan.filter((c) => c.kind === "unchanged")).toHaveLength(2);
    expect(plan.filter((c) => c.kind === "update")).toHaveLength(1);
    expect(plan.filter((c) => c.kind === "add")).toHaveLength(1);
    expect(plan.filter((c) => c.kind === "remove")).toHaveLength(0);
  });

  it("marks accounts missing from the upload for removal", () => {
    // An upload replaces the stored set, so anything the file omits goes. The
    // preview surfaces that before it happens.
    const plan = planUpload(
      [bal(), bal({ id: "b2", label: "Cash", currency: "USD" })],
      [{ label: "Cash", amount: 50, currency: "USD" }],
    );
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ kind: "update", id: "b2" });
    expect(plan[1]).toEqual({
      kind: "remove",
      id: "b1",
      label: "Monobank",
      amount: 8753,
      currency: "EUR",
    });
  });

  it("removes every stored account when none of them are in the file", () => {
    const plan = planUpload(
      [bal(), bal({ id: "b2", label: "Cash", currency: "USD" })],
      [{ label: "Wise", amount: 500, currency: "GBP" }],
    );
    expect(plan.filter((c) => c.kind === "remove")).toHaveLength(2);
    expect(plan.filter((c) => c.kind === "add")).toHaveLength(1);
  });

  it("reports no removals when the file covers everything held", () => {
    const plan = planUpload([bal()], [{ label: "Monobank", amount: 8753, currency: "EUR" }]);
    expect(plan.some((c) => c.kind === "remove")).toBe(false);
  });

  it("does not remove an account whose label only differs by case or spacing", () => {
    // Matching is forgiving on purpose: a re-export that writes "MonoBank"
    // must read as the same account, not as one removed and one added.
    const plan = planUpload([bal()], [{ label: "  monobank ", amount: 8753, currency: "EUR" }]);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("unchanged");
  });
});

describe("toUsd", () => {
  it("passes USD through untouched", () => {
    expect(toUsd({ amount: 1000, currency: "USD" }, RATES)).toBe(1000);
  });

  it("converts at the supplied rate", () => {
    expect(toUsd({ amount: 100, currency: "EUR" }, RATES)).toBeCloseTo(116, 6);
  });

  it("returns null when the rate is unknown", () => {
    expect(toUsd({ amount: 100, currency: "GBP" }, RATES)).toBeNull();
  });
});

describe("totalUsd", () => {
  it("sums across currencies", () => {
    const total = totalUsd(
      [bal({ amount: 100, currency: "EUR" }), bal({ id: "b2", amount: 1000, currency: "USD" })],
      RATES,
    );
    expect(total.usd).toBeCloseTo(1116, 6);
    expect(total.missing).toEqual([]);
  });

  it("names unconvertible currencies instead of counting them as zero", () => {
    // Counting a missing rate as zero would understate net worth silently.
    const total = totalUsd(
      [bal({ amount: 500, currency: "GBP" }), bal({ id: "b2", amount: 10, currency: "USD" })],
      RATES,
    );
    expect(total.usd).toBe(10);
    expect(total.missing).toEqual(["GBP"]);
  });
});

describe("ageInDays", () => {
  it("counts whole days since the balance was true", () => {
    const now = Date.parse("2026-08-19T00:00:00.000Z");
    expect(ageInDays("2026-08-09T00:00:00.000Z", now)).toBe(10);
    expect(ageInDays("2026-08-19T00:00:00.000Z", now)).toBe(0);
  });

  it("never reports a negative age", () => {
    const now = Date.parse("2026-08-19T00:00:00.000Z");
    expect(ageInDays("2026-09-01T00:00:00.000Z", now)).toBe(0);
  });

  it("returns null for an unparseable timestamp", () => {
    expect(ageInDays("not a date")).toBeNull();
  });
});

describe("balanceKey", () => {
  it("separates the same name in different currencies", () => {
    expect(balanceKey({ label: "cash", currency: "USD" })).not.toBe(
      balanceKey({ label: "cash", currency: "EUR" }),
    );
  });

  it("still matches forgivingly on name", () => {
    expect(balanceKey({ label: "  MonoBank ", currency: "usd" })).toBe(
      balanceKey({ label: "monobank", currency: "USD" }),
    );
  });
});

describe("duplicateKeys", () => {
  it("finds a name repeated in the same currency", () => {
    expect(
      duplicateKeys([
        { label: "cash", amount: 1, currency: "USD" },
        { label: "Cash", amount: 2, currency: "usd" },
      ]),
    ).toEqual([{ label: "Cash", currency: "usd" }]);
  });

  it("does not flag the same name in different currencies", () => {
    expect(
      duplicateKeys([
        { label: "cash", amount: 500, currency: "GBP" },
        { label: "cash", amount: 500, currency: "CHF" },
        { label: "cash", amount: 1316, currency: "USD" },
        { label: "cash", amount: 3950, currency: "EUR" },
      ]),
    ).toEqual([]);
  });
});
