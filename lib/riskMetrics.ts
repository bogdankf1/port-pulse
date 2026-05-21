// Pure-math helpers for portfolio risk metrics. No I/O, no React, no DOM —
// safe to import from server routes or client components.

export const TRADING_DAYS_PER_YEAR = 252;
export const DEFAULT_RISK_FREE_RATE = 0.04; // 4% annual, ~current US 3-month T-bill

/**
 * Convert a series of values (e.g. daily portfolio values) into daily simple
 * returns: r_i = v_i / v_{i-1} - 1.  Skips any pair where v_{i-1} is non-positive
 * or non-finite.
 */
export function dailyReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (!Number.isFinite(prev) || prev <= 0) continue;
    if (!Number.isFinite(cur)) continue;
    out.push(cur / prev - 1);
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/**
 * Sample standard deviation (Bessel-corrected, n-1 denominator).
 */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return Math.sqrt(s / (xs.length - 1));
}

/**
 * Sample covariance.  Requires the two arrays be the same length.
 */
export function covariance(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += (xs[i] - mx) * (ys[i] - my);
  }
  return s / (xs.length - 1);
}

/**
 * Annualized volatility from a sequence of daily returns.
 * σ_annual = σ_daily × √252.  Returned as a decimal (e.g. 0.184 = 18.4%).
 */
export function annualizedVolatility(returns: number[]): number {
  const s = stdDev(returns);
  if (!Number.isFinite(s)) return NaN;
  return s * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Sharpe ratio:  (mean(r) - rf_daily) / stddev(r) × √252.
 * rfAnnual is expressed as a decimal (0.04 = 4%).  Returns a unitless number.
 */
export function sharpeRatio(
  returns: number[],
  rfAnnual = DEFAULT_RISK_FREE_RATE,
): number {
  const s = stdDev(returns);
  if (!Number.isFinite(s) || s === 0) return NaN;
  const m = mean(returns);
  const rfDaily = rfAnnual / TRADING_DAYS_PER_YEAR;
  return ((m - rfDaily) / s) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Beta of a portfolio versus a benchmark, both expressed as daily returns of
 * the same length.  β = cov(p, b) / var(b).
 */
export function beta(
  portfolioReturns: number[],
  benchmarkReturns: number[],
): number {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) return NaN;
  const p = portfolioReturns.slice(portfolioReturns.length - n);
  const b = benchmarkReturns.slice(benchmarkReturns.length - n);
  const cov = covariance(p, b);
  const varB = covariance(b, b); // = sample variance
  if (!Number.isFinite(cov) || !Number.isFinite(varB) || varB === 0) return NaN;
  return cov / varB;
}

/**
 * Max drawdown of a value series.  Returns a non-positive decimal (e.g. -0.224
 * for -22.4%).  Returns 0 when the series is monotonically non-decreasing.
 */
export function maxDrawdown(values: number[]): number {
  if (values.length === 0) return NaN;
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = v / peak - 1;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

/**
 * Align two time-stamped series by their common timestamps.  The series must
 * be sorted ascending by time.  Returns a pair of value arrays of equal length.
 */
export function alignByTime(
  a: { time: number; value: number }[],
  b: { time: number; value: number }[],
): { aValues: number[]; bValues: number[] } {
  const bByTime = new Map<number, number>();
  for (const p of b) bByTime.set(p.time, p.value);
  const aValues: number[] = [];
  const bValues: number[] = [];
  for (const p of a) {
    const v = bByTime.get(p.time);
    if (typeof v !== "number") continue;
    aValues.push(p.value);
    bValues.push(v);
  }
  return { aValues, bValues };
}
