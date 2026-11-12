import { signedPct, usd } from "./format";
import type { Bar, Outlook, Trend } from "./types";

const HORIZON = 15;

function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function rsi(closes: number[], n = 14) {
  if (closes.length <= n) return 50;
  let up = 0,
    down = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) up += d;
    else down -= d;
  }
  return up + down === 0 ? 50 : (100 * up) / (up + down);
}

/**
 * Momentum read for the next 15 minutes from one-minute bars.
 *
 * Four inputs, each scaled by how much the stock is moving right now: the 5- and
 * 15-minute returns, the distance from the session's volume-weighted average price,
 * and a small pull back toward the middle when RSI is stretched. They are blended into
 * one score; past +/-0.2 the read leans that way. The range is one standard deviation
 * of a 15-minute move at the current one-minute volatility.
 */
export function outlookOf(symbol: string, bars: Bar[], price: number): Outlook | undefined {
  if (bars.length < 25 || !(price > 0)) return undefined;
  const closes = bars.map((b) => b.c);

  let pv = 0,
    vol = 0;
  for (const b of bars) {
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    vol += b.v;
  }
  const vwap = vol > 0 ? pv / vol : price;

  const rets = closes.slice(-61).map((c, i, a) => (i ? Math.log(c / a[i - 1]) : 0)).slice(1);
  const sigma1 = Math.max(stdev(rets), 1e-5);
  const back = (n: number) => price / closes[Math.max(0, closes.length - 1 - n)] - 1;
  const ret5 = back(5);
  const ret15 = back(15);
  const vsVwap = price / vwap - 1;
  const r = rsi(closes);

  const hi = Math.max(...bars.map((b) => b.h), price);
  const lo = Math.min(...bars.map((b) => b.l), price);

  const score =
    0.35 * Math.tanh(ret5 / (sigma1 * Math.sqrt(5))) +
    0.3 * Math.tanh(ret15 / (sigma1 * Math.sqrt(15))) +
    0.25 * Math.tanh(vsVwap / (sigma1 * Math.sqrt(30))) +
    0.1 * (r > 80 ? -1 : r < 20 ? 1 : (r - 50) / 50);

  const lean = score > 0.2 ? "up" : score < -0.2 ? "down" : "flat";
  const strength = Math.round(Math.min(1, Math.abs(score)) * 100);
  const move = price * sigma1 * Math.sqrt(HORIZON);

  const head =
    lean === "flat"
      ? "no clear lean"
      : `leaning ${lean === "up" ? "higher" : "lower"} (${strength >= 60 ? "strong" : strength >= 40 ? "moderate" : "slight"})`;
  const sentence =
    `Next ${HORIZON} minutes: ${head}. ${symbol} is ${signedPct(vsVwap)} ${vsVwap >= 0 ? "above" : "below"} its average price today ` +
    `and ${ret5 >= 0 ? "up" : "down"} ${signedPct(ret5).replace(/^[+-]/, "")} over the last 5 minutes. ` +
    `A typical ${HORIZON}-minute move right now is ±${usd(move)}, so ${usd(price - move)} to ${usd(price + move)} is the likely range.`;

  return {
    horizonMin: HORIZON,
    lean,
    strength,
    sentence,
    move,
    low: price - move,
    high: price + move,
    vwap,
    vsVwap,
    ret5,
    ret15,
    rsi: r,
    dayPos: hi > lo ? (price - lo) / (hi - lo) : 0.5,
  };
}

export function trendOf(daily: Bar[], price: number): Trend | undefined {
  if (daily.length < 21) return undefined;
  const last = daily.slice(-20);
  const sma20 = last.reduce((s, b) => s + b.c, 0) / last.length;
  const rets = daily.slice(-21).map((b, i, a) => (i ? Math.log(b.c / a[i - 1].c) : 0)).slice(1);
  return {
    sma20,
    vsSma20: price / sma20 - 1,
    rv20: stdev(rets) * Math.sqrt(252),
    high20: Math.max(...last.map((b) => b.h)),
    low20: Math.min(...last.map((b) => b.l)),
  };
}
