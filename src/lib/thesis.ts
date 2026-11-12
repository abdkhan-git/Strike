import { chartOf, provider, signals } from "./market";
import type { Bar, Signal } from "./types";

/**
 * Full read on one symbol: every factor scored from -1 (bearish) to +1 (bullish), a
 * weighted total from -100 to +100, reversal warnings, and the price levels that matter.
 *
 * Both the picks and the position calls use this same read, so a trade is chosen and
 * then judged by the same evidence. Short-term noise (the last few minutes) carries
 * little weight; trend, structure and where the money is going carry most.
 */

export interface Factor {
  key: string;
  label: string;
  /** -1 bearish .. +1 bullish */
  value: number;
  weight: number;
  note: string;
}

export interface Analysis {
  symbol: string;
  price: number;
  changePct: number;
  /** -100 (strongly bearish) .. +100 (strongly bullish) */
  score: number;
  factors: Factor[];
  /** signs that the current move is running out of steam */
  reversal: { risk: number; against: "bullish" | "bearish" | null; signs: string[] };
  levels: { support: number; resistance: number; atr: number; dayLow: number; dayHigh: number; vwap?: number };
  flow?: { direction: "bullish" | "bearish"; conviction: number; horizons: string[] };
  asOf: number;
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pctTxt = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

function sma(xs: number[], n: number, end = xs.length) {
  return mean(xs.slice(Math.max(0, end - n), end));
}

function ema(xs: number[], n: number) {
  const k = 2 / (n + 1);
  const out: number[] = [];
  xs.forEach((x, i) => out.push(i ? x * k + out[i - 1] * (1 - k) : x));
  return out;
}

function rsiSeries(closes: number[], n = 14) {
  const out: number[] = new Array(closes.length).fill(50);
  let up = 0,
    down = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const u = Math.max(d, 0),
      v = Math.max(-d, 0);
    if (i <= n) {
      up += u / n;
      down += v / n;
    } else {
      up = (up * (n - 1) + u) / n;
      down = (down * (n - 1) + v) / n;
    }
    if (i >= n) out[i] = down === 0 ? 100 : 100 - 100 / (1 + up / down);
  }
  return out;
}

function atrOf(bars: Bar[], n = 14) {
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)));
  return mean(tr.slice(-n));
}

/** One-minute bars rolled up into five-minute bars. */
function fiveMin(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / 300_000) * 300_000;
    const last = out.at(-1);
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else out.push({ ...b, t });
  }
  return out;
}

/** Daily candlestick patterns on the last few sessions. Positive = bullish. */
function candles(d: Bar[]): { value: number; note: string } {
  if (d.length < 4) return { value: 0, note: "not enough history" };
  const [a, b, c] = d.slice(-3);
  const body = (x: Bar) => Math.abs(x.c - x.o);
  const range = (x: Bar) => Math.max(x.h - x.l, 1e-9);
  const upperWick = (x: Bar) => x.h - Math.max(x.o, x.c);
  const lowerWick = (x: Bar) => Math.min(x.o, x.c) - x.l;
  const prior = d.slice(-8, -1).map((x) => x.c);
  const downtrend = prior.length > 3 && prior.at(-1)! < prior[0];
  const uptrend = prior.length > 3 && prior.at(-1)! > prior[0];
  const found: [number, string][] = [];

  if (c.c > c.o && b.c < b.o && c.c >= b.o && c.o <= b.c && body(c) > body(b)) found.push([0.8, "bullish engulfing candle"]);
  if (c.c < c.o && b.c > b.o && c.o >= b.c && c.c <= b.o && body(c) > body(b)) found.push([-0.8, "bearish engulfing candle"]);
  if (lowerWick(c) > 2 * body(c) && upperWick(c) < body(c) + range(c) * 0.1 && downtrend) found.push([0.6, "hammer after a decline"]);
  if (upperWick(c) > 2 * body(c) && lowerWick(c) < body(c) + range(c) * 0.1 && uptrend) found.push([-0.6, "shooting star after a rally"]);
  if (body(c) < range(c) * 0.1) found.push([uptrend ? -0.25 : downtrend ? 0.25 : 0, "doji (indecision)"]);
  if ([a, b, c].every((x) => x.c > x.o) && b.c > a.c && c.c > b.c) found.push([0.5, "three rising sessions"]);
  if ([a, b, c].every((x) => x.c < x.o) && b.c < a.c && c.c < b.c) found.push([-0.5, "three falling sessions"]);
  if (c.l > b.h) found.push([0.4, "gap up held"]);
  if (c.h < b.l) found.push([-0.4, "gap down held"]);

  if (!found.length) return { value: c.c >= c.o ? 0.1 : -0.1, note: c.c >= c.o ? "last session closed up, no pattern" : "last session closed down, no pattern" };
  const value = clamp(found.reduce((s, [v]) => s + v, 0));
  return { value, note: found.map(([, n]) => n).join(", ") };
}

/** Signs a move is ending: divergence, exhaustion, volume climax, failed breakout, stretched far from the average. */
function reversalSigns(d: Bar[], intraday: Bar[], price: number, rsi: number[], macdHist: number[]) {
  const signs: { dir: "bullish" | "bearish"; w: number; text: string }[] = [];
  const closes = d.map((x) => x.c);
  const n = closes.length;
  if (n < 30) return signs;

  // price at a 10-day high/low while RSI is not
  const hi10 = Math.max(...closes.slice(-10, -1));
  const lo10 = Math.min(...closes.slice(-10, -1));
  const rsiHi = Math.max(...rsi.slice(-10, -1));
  const rsiLo = Math.min(...rsi.slice(-10, -1));
  if (price > hi10 && rsi[n - 1] < rsiHi - 3) signs.push({ dir: "bullish", w: 0.35, text: "new 10-day high but RSI is lower than at the last high (bearish divergence)" });
  if (price < lo10 && rsi[n - 1] > rsiLo + 3) signs.push({ dir: "bearish", w: 0.35, text: "new 10-day low but RSI is higher than at the last low (bullish divergence)" });

  // MACD momentum fading while price still pushes
  const h = macdHist.slice(-4);
  if (h.length === 4 && h.every((x) => x > 0) && h[3] < h[2] && h[2] < h[1] && closes[n - 1] > closes[n - 4])
    signs.push({ dir: "bullish", w: 0.2, text: "MACD momentum shrinking for 3 sessions while price rises" });
  if (h.length === 4 && h.every((x) => x < 0) && h[3] > h[2] && h[2] > h[1] && closes[n - 1] < closes[n - 4])
    signs.push({ dir: "bearish", w: 0.2, text: "MACD selling pressure shrinking for 3 sessions while price falls" });

  // stretched: far from the 20-day average and RSI extreme
  const s20 = sma(closes, 20);
  const stretch = (price - s20) / s20;
  const vol = Math.sqrt(mean(closes.slice(-21).slice(1).map((c, i, a) => Math.log(c / (i ? a[i - 1] : closes[n - 21])) ** 2)));
  if (rsi[n - 1] > 75 && stretch > 3 * vol) signs.push({ dir: "bullish", w: 0.3, text: `overbought: RSI ${rsi[n - 1].toFixed(0)}, ${pctTxt(stretch)} above the 20-day average` });
  if (rsi[n - 1] < 25 && stretch < -3 * vol) signs.push({ dir: "bearish", w: 0.3, text: `oversold: RSI ${rsi[n - 1].toFixed(0)}, ${pctTxt(stretch)} below the 20-day average` });

  // volume climax: today's pace far above normal with a long wick against the move
  const avgVol = mean(d.slice(-21, -1).map((x) => x.v));
  const last = d[n - 1];
  const range = Math.max(last.h - last.l, 1e-9);
  if (avgVol > 0 && last.v > 2.2 * avgVol) {
    if (last.h - Math.max(last.o, last.c) > range * 0.5) signs.push({ dir: "bullish", w: 0.3, text: "heavy volume with a long upper wick (buyers exhausted)" });
    if (Math.min(last.o, last.c) - last.l > range * 0.5) signs.push({ dir: "bearish", w: 0.3, text: "heavy volume with a long lower wick (sellers exhausted)" });
  }

  // intraday failed breakout: took out the morning high/low and fell back through VWAP
  if (intraday.length > 60) {
    const early = intraday.slice(0, 30);
    const eh = Math.max(...early.map((x) => x.h));
    const el = Math.min(...early.map((x) => x.l));
    const later = intraday.slice(30);
    const madeHigh = later.some((x) => x.h > eh * 1.001);
    const madeLow = later.some((x) => x.l < el * 0.999);
    if (madeHigh && price < eh) signs.push({ dir: "bullish", w: 0.25, text: "broke the morning high and fell back below it (failed breakout)" });
    if (madeLow && price > el) signs.push({ dir: "bearish", w: 0.25, text: "broke the morning low and climbed back above it (failed breakdown)" });
  }
  return signs;
}

function flowFactor(list: Signal[], symbol: string): { value: number; note: string; flow?: Analysis["flow"] } {
  const mine = list.filter((s) => s.symbol === symbol);
  if (!mine.length) return { value: 0, note: "no one-sided option flow" };
  // longer horizons count more: same-day flow is mostly hedging and scalping
  const w = { eod: 0.4, week: 1, month: 1.2, quarter: 1 } as const;
  let num = 0,
    den = 0;
  for (const s of mine) {
    const sign = s.direction === "bullish" ? 1 : -1;
    num += sign * (s.conviction / 100) * w[s.horizon];
    den += w[s.horizon];
  }
  const value = clamp((num / den) * 1.6);
  const best = [...mine].sort((a, b) => b.conviction - a.conviction)[0];
  const agree = mine.filter((s) => s.direction === best.direction).map((s) => s.horizon);
  return {
    value,
    note: mine.map((s) => `${s.horizon} ${s.direction} ${s.conviction}`).join(", "),
    flow: { direction: best.direction, conviction: best.conviction, horizons: agree },
  };
}

/** The full read. Uses cached chart, SPY and signal data, so it is cheap to call often. */
export async function analyze(symbol: string): Promise<Analysis | undefined> {
  const [chart, spy, list, quotes] = await Promise.all([
    chartOf(symbol).catch(() => undefined),
    symbol === "SPY" ? Promise.resolve(undefined) : chartOf("SPY").catch(() => undefined),
    signals().catch(() => undefined),
    provider().quotes([symbol, "SPY"]).catch(() => ({}) as Record<string, { price: number; changePct: number }>),
  ]);
  const q = quotes[symbol];
  if (!chart || !q || chart.daily.length < 30) return undefined;
  const price = q.price;
  // today's daily bar is replaced by the live price so every factor sees the current session
  const today = new Date().toISOString().slice(0, 10);
  const daily = chart.daily.filter((b) => new Date(b.t).toISOString().slice(0, 10) !== today);
  const intra = chart.bars;
  const dayHigh = intra.length ? Math.max(...intra.map((b) => b.h)) : price;
  const dayLow = intra.length ? Math.min(...intra.map((b) => b.l)) : price;
  const live: Bar = { t: Date.now(), o: intra[0]?.o ?? price, h: dayHigh, l: dayLow, c: price, v: intra.reduce((s, b) => s + b.v, 0) };
  const d = [...daily, live];
  const closes = d.map((b) => b.c);
  const n = closes.length;

  const factors: Factor[] = [];
  const add = (key: string, label: string, value: number, weight: number, note: string) =>
    factors.push({ key, label, value: clamp(value), weight, note });

  // trend: price vs 20/50-day averages and the 20-day slope
  const s20 = sma(closes, 20),
    s50 = sma(closes, 50),
    s20prev = sma(closes, 20, n - 5);
  const slope = (s20 - s20prev) / s20prev;
  add(
    "trend",
    "Trend (20/50-day)",
    0.35 * Math.sign(price - s20) + 0.35 * Math.sign(s20 - s50) + 0.3 * clamp(slope / 0.02),
    0.16,
    `price ${pctTxt(price / s20 - 1)} vs 20-day, 20-day ${s20 > s50 ? "above" : "below"} 50-day, 20-day slope ${pctTxt(slope)} a week`,
  );

  // multi-day momentum, scaled by how much the stock usually moves
  const rets = closes.slice(-21).map((c, i, a) => (i ? Math.log(c / a[i - 1]) : 0)).slice(1);
  const dvol = Math.sqrt(mean(rets.map((r) => r * r))) || 0.01;
  const r5 = price / closes[n - 6] - 1;
  add("momentum", "5-day momentum", Math.tanh(r5 / (dvol * Math.sqrt(5))), 0.1, `${pctTxt(r5)} over 5 sessions`);

  // RSI and MACD on daily closes
  const rsi = rsiSeries(closes);
  const r = rsi[n - 1];
  add("rsi", "RSI (14-day)", r > 75 ? -0.6 : r < 25 ? 0.6 : ((r - 50) / 50) * 0.8, 0.06, `${r.toFixed(0)}${r > 70 ? ", overbought" : r < 30 ? ", oversold" : ""}`);
  const macd = ema(closes, 12).map((x, i) => x - ema(closes, 26)[i]);
  const signal = ema(macd, 9);
  const hist = macd.map((x, i) => x - signal[i]);
  add(
    "macd",
    "MACD",
    0.6 * Math.sign(hist[n - 1]) + 0.4 * Math.sign(hist[n - 1] - hist[n - 2]),
    0.08,
    `histogram ${hist[n - 1] >= 0 ? "positive" : "negative"} and ${hist[n - 1] > hist[n - 2] ? "rising" : "falling"}`,
  );

  const cs = candles(d);
  add("candles", "Daily candles", cs.value, 0.08, cs.note);

  // intraday structure on 5-minute bars: VWAP side and the slope of the last hour
  const five = fiveMin(intra);
  if (five.length >= 6) {
    const vwap = chart.outlook?.vwap ?? price;
    const last12 = five.slice(-12).map((b) => b.c);
    const slope5 = (last12.at(-1)! - last12[0]) / last12[0];
    const hh = five.slice(-6).every((b, i, a) => !i || b.l >= a[i - 1].l * 0.999);
    const ll = five.slice(-6).every((b, i, a) => !i || b.h <= a[i - 1].h * 1.001);
    add(
      "intraday",
      "Intraday structure",
      0.45 * clamp((price / vwap - 1) / 0.004) + 0.35 * clamp(slope5 / 0.006) + (hh ? 0.2 : ll ? -0.2 : 0),
      0.1,
      `${pctTxt(price / vwap - 1)} vs VWAP, last hour ${pctTxt(slope5)}${hh ? ", higher lows" : ll ? ", lower highs" : ""}`,
    );
  }

  // where options money is going, all horizons
  const ff = list ? flowFactor(list.signals, symbol) : { value: 0, note: "flow unavailable" };
  add("flow", "Options flow", ff.value, 0.2, ff.note);

  // the market: SPY direction for everything else, plus relative strength against it
  if (spy && symbol !== "SPY") {
    const spyQ = quotes.SPY;
    const spyTrend = spy.trend ? Math.sign(spy.trend.vsSma20) : 0;
    const rs = (q.changePct ?? 0) - (spyQ?.changePct ?? 0);
    add(
      "market",
      "Market and relative strength",
      0.4 * Math.sign(spyQ?.changePct ?? 0) + 0.2 * spyTrend + 0.4 * clamp(rs / 0.015),
      0.1,
      `SPY ${pctTxt(spyQ?.changePct ?? 0)} today, ${symbol} ${pctTxt(rs)} vs SPY`,
    );
  }

  const score = Math.round((100 * factors.reduce((s, f) => s + f.value * f.weight, 0)) / factors.reduce((s, f) => s + f.weight, 0));

  const signs = reversalSigns(d, intra, price, rsi, hist);
  const against = score > 0 ? "bullish" : score < 0 ? "bearish" : null;
  const relevant = signs.filter((s) => s.dir === against);
  const risk = clamp(relevant.reduce((s, x) => s + x.w, 0), 0, 1);

  // support/resistance: the nearest swing levels of the last 20 sessions
  const last20 = d.slice(-21, -1);
  const atr = atrOf(d);
  const support = Math.max(...last20.map((b) => b.l).filter((x) => x < price), price - 2 * atr);
  const resistance = Math.min(...last20.map((b) => b.h).filter((x) => x > price), price + 2 * atr);

  return {
    symbol,
    price,
    changePct: q.changePct,
    score,
    factors,
    reversal: { risk, against: relevant.length ? against : null, signs: relevant.map((s) => s.text) },
    levels: { support, resistance, atr, dayLow, dayHigh, vwap: chart.outlook?.vwap },
    flow: ff.flow,
    asOf: Date.now(),
  };
}

/** One line for the score: "Bullish 62/100" etc. */
export const scoreLabel = (score: number) =>
  `${score >= 15 ? "Bullish" : score <= -15 ? "Bearish" : "Neutral"} ${score > 0 ? "+" : ""}${score}`;
