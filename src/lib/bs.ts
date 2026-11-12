import type { OptType } from "./types";

/** Risk-free rate assumption used across the app. */
export const RATE = 0.04;

export function normCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

const pdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

export function intrinsic(type: OptType, S: number, K: number) {
  return Math.max(type === "call" ? S - K : K - S, 0);
}

export function bsPrice(type: OptType, S: number, K: number, T: number, sigma: number, r = RATE) {
  if (T <= 0 || sigma <= 0) return intrinsic(type, S, K);
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / sq;
  const d2 = d1 - sq;
  return type === "call"
    ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2)
    : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

export function bsGreeks(type: OptType, S: number, K: number, T: number, sigma: number, r = RATE) {
  if (T <= 0 || sigma <= 0) {
    const itm = intrinsic(type, S, K) > 0;
    return { delta: itm ? (type === "call" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / sq;
  const d2 = d1 - sq;
  const delta = type === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf(d1) / (S * sq);
  const vega = (S * pdf(d1) * Math.sqrt(T)) / 100;
  const carry =
    type === "call" ? -r * K * Math.exp(-r * T) * normCdf(d2) : r * K * Math.exp(-r * T) * normCdf(-d2);
  const theta = ((-S * pdf(d1) * sigma) / (2 * Math.sqrt(T)) + carry) / 365;
  return { delta, gamma, theta, vega };
}

/** Risk-neutral probability that the underlying finishes above `level` at T. */
export function probAbove(S: number, level: number, T: number, sigma: number, r = RATE) {
  if (level <= 0) return 1;
  if (T <= 0 || sigma <= 0) return S > level ? 1 : 0;
  const d2 = (Math.log(S / level) + (r - (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  return normCdf(d2);
}

export function breakeven(type: OptType, K: number, premium: number) {
  return type === "call" ? K + premium : K - premium;
}

/** Market-implied probability a long option bought at `premium` is profitable at expiry. */
export function popLong(type: OptType, S: number, K: number, premium: number, T: number, sigma: number) {
  const be = breakeven(type, K, premium);
  const above = probAbove(S, be, T, sigma);
  return type === "call" ? above : 1 - above;
}

/** Solve for the volatility that reproduces `price`. Returns 0 if no solution in range. */
export function impliedVol(type: OptType, S: number, K: number, T: number, price: number, r = RATE) {
  if (T <= 0 || price <= 0 || S <= 0) return 0;
  const floor = Math.max(type === "call" ? S - K * Math.exp(-r * T) : K * Math.exp(-r * T) - S, 0);
  if (price <= floor + 1e-6) return 0; // at or below intrinsic: IV undefined
  let lo = 0.005,
    hi = 6;
  if (bsPrice(type, S, K, T, hi, r) < price) return 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(type, S, K, T, mid, r) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
