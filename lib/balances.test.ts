import { describe, expect, it } from "vitest";
import {
  ageInDays,
  balanceKey,
  duplicateKeys,
  groupBalances,
  hasGroups,
  normalizeGroup,
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
    group: null,
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

  it("keeps the same account name at different banks apart", () => {
    // The shape the second real file had: every bank names its accounts the
    // same way, so "USD card" is three accounts, not one written three times.
    const existing = [
      bal({ id: "m1", label: "USD card", amount: 5267, currency: "USD", group: "Monobank" }),
      bal({ id: "p1", label: "USD card", amount: 8834, currency: "USD", group: "Privatbank" }),
    ];
    const plan = planUpload(existing, [
      { label: "USD card", amount: 5267, currency: "USD", group: "Monobank" },
      { label: "USD card", amount: 9000, currency: "USD", group: "Privatbank" },
      { label: "USD card", amount: 5571, currency: "USD", group: "PUMB" },
    ]);
    expect(plan.filter((c) => c.kind === "unchanged")).toHaveLength(1);
    expect(plan.filter((c) => c.kind === "update")).toHaveLength(1);
    expect(plan.filter((c) => c.kind === "add")).toHaveLength(1);
    expect(plan.filter((c) => c.kind === "remove")).toHaveLength(0);
  });

  it("treats moving an account to another bank as a move, not an edit", () => {
    // Honest: nothing in the file distinguishes a re-labelled bank from
    // closing an account at one and opening it at another.
    const plan = planUpload(
      [bal({ id: "m1", label: "Deposit", currency: "USD", group: "Monobank" })],
      [{ label: "Deposit", amount: 8753, currency: "USD", group: "Privatbank" }],
    );
    expect(plan.map((c) => c.kind).sort()).toEqual(["add", "remove"]);
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
      group: null,
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
  it("separates the same name and currency at different banks", () => {
    expect(balanceKey({ label: "USD card", currency: "USD", group: "Monobank" })).not.toBe(
      balanceKey({ label: "USD card", currency: "USD", group: "PUMB" }),
    );
  });

  it("reads a blank group and a missing one as the same account", () => {
    expect(balanceKey({ label: "cash", currency: "USD", group: "  " })).toBe(
      balanceKey({ label: "cash", currency: "USD" }),
    );
  });

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
    ).toEqual([{ label: "Cash", currency: "usd", group: null }]);
  });

  it("does not flag the same account name at different banks", () => {
    expect(
      duplicateKeys([
        { label: "USD card", amount: 1, currency: "USD", group: "Monobank" },
        { label: "USD card", amount: 2, currency: "USD", group: "PUMB" },
      ]),
    ).toEqual([]);
  });

  it("flags a repeat within one bank", () => {
    expect(
      duplicateKeys([
        { label: "USD card", amount: 1, currency: "USD", group: "Monobank" },
        { label: "usd card", amount: 2, currency: "usd", group: " monobank " },
      ]),
    ).toEqual([{ label: "usd card", currency: "usd", group: "monobank" }]);
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

describe("normalizeGroup", () => {
  it("reads a blank or absent group as no group at all", () => {
    expect(normalizeGroup("  ")).toBeNull();
    expect(normalizeGroup(null)).toBeNull();
    expect(normalizeGroup(undefined)).toBeNull();
  });

  it("keeps a real group, trimmed", () => {
    expect(normalizeGroup("  Monobank ")).toBe("Monobank");
  });
});

describe("hasGroups", () => {
  it("is false when no account says where it is held", () => {
    expect(hasGroups([bal(), bal({ id: "b2", group: "  " })])).toBe(false);
  });

  it("is true as soon as one does", () => {
    expect(hasGroups([bal(), bal({ id: "b2", group: "Monobank" })])).toBe(true);
  });
});

describe("groupBalances", () => {
  const rates = new Map([["EUR", 2]]);

  it("subtotals each bank in USD", () => {
    const groups = groupBalances(
      [
        bal({ id: "m1", amount: 100, currency: "USD", group: "Monobank" }),
        bal({ id: "m2", amount: 50, currency: "EUR", group: "Monobank" }),
        bal({ id: "p1", amount: 40, currency: "USD", group: "Privatbank" }),
      ],
      rates,
    );
    expect(groups.map((g) => [g.name, g.usd])).toEqual([
      ["Monobank", 200],
      ["Privatbank", 40],
    ]);
  });

  it("sorts banks by how much they hold, largest first", () => {
    const groups = groupBalances(
      [
        bal({ id: "a", amount: 10, currency: "USD", group: "Small" }),
        bal({ id: "b", amount: 900, currency: "USD", group: "Big" }),
      ],
      rates,
    );
    expect(groups.map((g) => g.name)).toEqual(["Big", "Small"]);
  });

  it("puts accounts with no bank last, however large", () => {
    // A leftover bucket is not a bank, so it does not compete for the top.
    const groups = groupBalances(
      [
        bal({ id: "a", amount: 9000, currency: "USD", group: null }),
        bal({ id: "b", amount: 1, currency: "USD", group: "Monobank" }),
      ],
      rates,
    );
    expect(groups.map((g) => g.name)).toEqual(["Monobank", null]);
  });

  it("names a group's unconvertible currencies rather than counting them zero", () => {
    const groups = groupBalances(
      [
        bal({ id: "a", amount: 100, currency: "USD", group: "Cash" }),
        bal({ id: "b", amount: 500, currency: "GBP", group: "Cash" }),
      ],
      rates,
    );
    expect(groups[0].usd).toBe(100);
    expect(groups[0].missing).toEqual(["GBP"]);
  });

  it("buckets blank and absent groups together", () => {
    const groups = groupBalances(
      [bal({ id: "a", group: "  " }), bal({ id: "b", group: null })],
      rates,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].balances).toHaveLength(2);
  });
});
