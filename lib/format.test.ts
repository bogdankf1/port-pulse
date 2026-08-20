import { describe, expect, it } from "vitest";
import { formatCurrency } from "./format";

describe("formatCurrency", () => {
  it("writes the currency's sign, not its code", () => {
    expect(formatCurrency(5267, "USD")).toBe("$5,267.00");
    expect(formatCurrency(4993, "EUR")).toBe("€4,993.00");
    expect(formatCurrency(500, "GBP")).toBe("£500.00");
  });

  it("uses the narrow sign, so USD is $ and not US$", () => {
    expect(formatCurrency(1, "USD")).not.toContain("US$");
  });

  it("falls back to the code for a currency with no sign", () => {
    // Honest rather than clever: inventing a glyph for CHF would be worse
    // than showing what the file said.
    // The separator Intl uses here is a non-breaking space, not a plain one.
    expect(formatCurrency(500, "CHF")).toBe("CHF\u00a0500.00");
  });
});
