import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key";

const { correlation } = await import("./analysis");

describe("correlation", () => {
  it("is 1 for a series with itself", () => {
    const xs = [0.01, -0.02, 0.03, 0.005, -0.01];
    expect(correlation(xs, xs)).toBeCloseTo(1, 10);
  });

  it("is -1 for a perfectly inverted series", () => {
    const xs = [0.01, -0.02, 0.03, 0.005, -0.01];
    expect(correlation(xs, xs.map((x) => -x))).toBeCloseTo(-1, 10);
  });

  it("is near zero for unrelated series", () => {
    const xs = [1, -1, 1, -1, 1, -1];
    const ys = [1, 1, -1, -1, 1, 1];
    expect(Math.abs(correlation(xs, ys)!)).toBeLessThan(0.5);
  });

  it("stays inside [-1, 1] despite floating-point drift", () => {
    // Pearson is mathematically bounded, but the covariance/stdDev division
    // can land a hair outside; a correlation of 1.0000000000000002 in a tool
    // result reads as a bug to anyone checking the numbers.
    const xs = [1e-9, 2e-9, 3e-9, 4e-9];
    const r = correlation(xs, xs)!;
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(-1);
  });

  it("returns null when a series cannot be correlated", () => {
    expect(correlation([0.01], [0.02])).toBeNull();
    expect(correlation([0.01, 0.02], [0.01])).toBeNull();
    // A flat series has zero variance, so correlation is undefined rather
    // than zero — reporting 0 would claim independence we cannot show.
    expect(correlation([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });
});
