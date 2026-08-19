import { describe, expect, it } from "vitest";
import { CalcError, evaluate } from "./calc";

describe("evaluate", () => {
  it("does the four operations with correct precedence", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("10 - 4 - 3")).toBe(3);
    expect(evaluate("100 / 4 / 5")).toBe(5);
  });

  it("handles unary and repeated signs", () => {
    expect(evaluate("-5 + 2")).toBe(-3);
    expect(evaluate("-(3 * 2)")).toBe(-6);
    expect(evaluate("--4")).toBe(4);
  });

  it("is right-associative for exponentiation and allows a signed exponent", () => {
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("2 ^ -1")).toBe(0.5);
  });

  it("accepts the shapes the model actually writes", () => {
    // Thousands separators, currency symbols, and percent literals all appear
    // in portfolio arithmetic.
    expect(evaluate("32,301.78 - 12,245.10")).toBeCloseTo(20056.68, 2);
    expect(evaluate("$5,189.00 + $4,258.40")).toBeCloseTo(9447.4, 2);
    expect(evaluate("204593.81 * 15.9%")).toBeCloseTo(32530.42, 2);
    expect(evaluate("15%")).toBeCloseTo(0.15, 10);
  });

  it("computes a realistic portfolio question", () => {
    // "What would half my NVDA be worth?"
    expect(evaluate("147 / 2 * 219.74")).toBeCloseTo(16150.89, 2);
  });

  it("rejects division by zero rather than returning Infinity", () => {
    expect(() => evaluate("1 / 0")).toThrow(CalcError);
  });

  it("rejects anything that is not arithmetic", () => {
    // The grammar has no identifiers, so there is nothing to escape into.
    for (const bad of [
      "process.exit(1)",
      "require('fs')",
      "1; console.log(2)",
      "globalThis",
      "fetch('http://x')",
      "__proto__",
      "2 + x",
    ]) {
      expect(() => evaluate(bad), bad).toThrow(CalcError);
    }
  });

  it("rejects malformed arithmetic", () => {
    for (const bad of ["", "   ", "1 +", "* 3", "(1 + 2", "1 + 2)", "1 2"]) {
      expect(() => evaluate(bad), JSON.stringify(bad)).toThrow(CalcError);
    }
  });

  it("rejects a non-finite result instead of returning Infinity", () => {
    expect(() => evaluate("9 ^ 9 ^ 9")).toThrow(CalcError);
  });
});
