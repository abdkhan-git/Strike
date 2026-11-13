import { cached } from "./cache";
import { chartOf, premarketOf } from "./market";
import { etDay, session } from "./session";
import type { Bar } from "./types";

/**
 * The open: how far a stock gapped from yesterday's close, what it did with the gap, and
 * what this stock has done after similar gaps over the last six months.
 *
 *   Before 9:30   the gap is measured from pre-market trades. It is a lean, not a signal:
 *                 most of what a gap means shows only after the open. How much it counts
 *                 depends on pre-market volume and on the stock's own record with gaps.
 *   After 9:30    the gap is measured from the regular open and judged by how much of it
 *                 is left: extending past the open, holding, fading, or filled (the stock
 *                 is back through yesterday's close, a failed gap). A break of the first
 *                 15 minutes' range (the opening range) adds to the read once 30 minutes
 *                 have traded.
 *
 * Sizes are in ATR: one ATR is a normal day's range, so a 1.0× gap is a full day's move
 * before the bell. Gaps beyond 2× are counted at half strength: big gaps exhaust often.
 */

export interface GapRead {
  symbol: string;
  prevClose: number;
  price: number;
  /** a normal day's range (14-day ATR) */
  atr: number;
  phase: "pre" | "open" | "none";
  /** the regular session's first price */
  open?: number;
  /** today's high and low so far (pre-market before 9:30, the regular session after) */
  day?: { high: number; low: number };
  pre?: { last: number; high: number; low: number; volume: number; /** pre-market volume as a share of a normal day's */ volShare?: number };
  gapPct: number;
  gapAtr: number;
  /** share of the gap given back: 0 none, 1 fully filled, negative = extended beyond the open */
  fill?: number;
  state: "none" | "pre-market" | "extending" | "holding" | "fading" | "filled";
  /** opening range: the first 15 minutes' high and low, and where the price is against them */
  range?: { high: number; low: number; side: "above" | "below" | "inside" };
  /** this stock's record after gaps in the same direction and of similar size, last ~6 months */
  history?: { n: number; filled: number; continued: number };
  /** -1 bearish .. +1 bullish, for the full analysis */
  value: number;
  note: string;
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const sgn = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const pctTxt = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

export function atr14(bars: Bar[]) {
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)));
  const last = tr.slice(-14);
  return last.length ? last.reduce((s, x) => s + x, 0) / last.length : 0;
}

/** How this stock's past gaps of the same direction and similar size played out. */
function gapHistory(daily: Bar[], dir: number, size: number) {
  let n = 0,
    filled = 0,
    continued = 0;
  const big = size >= 1;
  for (let i = 15; i < daily.length; i++) {
    const prev = daily[i - 1];
    const d = daily[i];
    const a = atr14(daily.slice(Math.max(0, i - 15), i));
    if (!(a > 0)) continue;
    const g = (d.o - prev.c) / a;
    if (sgn(g) !== dir || Math.abs(g) < 0.3 || (big ? Math.abs(g) < 1 : Math.abs(g) >= 1)) continue;
    n++;
    if (dir > 0 ? d.l <= prev.c : d.h >= prev.c) filled++;
    if (dir > 0 ? d.c > d.o : d.c < d.o) continued++;
  }
  return n ? { n, filled, continued } : undefined;
}

/**
 * Reads the gap from completed daily bars (today excluded), today's regular-session bars
 * and, before the open, today's pre-market bars. Pure: the analysis and the brief share it.
 */
export function readGap(symbol: string, daily: Bar[], today: Bar[], pre: Bar[], price: number, prevClose: number): GapRead {
  const atr = atr14(daily);
  const base = { symbol, prevClose, price, atr };
  if (!(atr > 0) || !(prevClose > 0)) return { ...base, phase: "none", gapPct: 0, gapAtr: 0, state: "none", value: 0, note: "not enough history to read the gap" };
  const avgVol = daily.slice(-20).reduce((s, b) => s + b.v, 0) / Math.max(1, Math.min(20, daily.length));

  // --- before the open: pre-market trades ---------------------------------------------
  if (!today.length) {
    if (!pre.length) return { ...base, phase: "none", gapPct: price / prevClose - 1, gapAtr: (price - prevClose) / atr, state: "none", value: 0, note: "no trades yet today" };
    const last = pre.at(-1)!.c;
    const volume = pre.reduce((s, b) => s + b.v, 0);
    const volShare = avgVol > 0 ? volume / avgVol : undefined;
    const gapAtr = (last - prevClose) / atr;
    const dir = sgn(gapAtr);
    const preInfo = { last, high: Math.max(...pre.map((b) => b.h)), low: Math.min(...pre.map((b) => b.l)), volume, volShare };
    if (Math.abs(gapAtr) < 0.3)
      return { ...base, price: last, phase: "pre", pre: preInfo, day: { high: preInfo.high, low: preInfo.low }, gapPct: last / prevClose - 1, gapAtr, state: "none", value: 0, note: `pre-market ${pctTxt(last / prevClose - 1)}, too small to mean anything (${Math.abs(gapAtr).toFixed(1)}× a normal day)` };
    const history = gapHistory(daily, dir, Math.abs(gapAtr));
    // a gap counts toward continuation only as far as this stock's own gaps have continued
    const lean = history && history.n >= 5 ? 2 * (history.continued / history.n) - 1 : 0.3;
    const heavy = volShare !== undefined && volShare >= 0.05 ? 1.25 : volShare !== undefined && volShare < 0.01 ? 0.6 : 1;
    const exhaust = Math.abs(gapAtr) > 2 ? 0.5 : 1;
    const value = clamp(dir * Math.min(1, Math.abs(gapAtr)) * 0.5 * lean * heavy * exhaust);
    return {
      ...base,
      price: last,
      phase: "pre",
      pre: preInfo,
      day: { high: preInfo.high, low: preInfo.low },
      gapPct: last / prevClose - 1,
      gapAtr,
      state: "pre-market",
      history,
      value,
      note: `pre-market gap ${pctTxt(last / prevClose - 1)} (${Math.abs(gapAtr).toFixed(1)}× a normal day)${
        volShare !== undefined ? `, pre-market volume ${(volShare * 100).toFixed(1)}% of a normal day${heavy > 1 ? " (heavy)" : heavy < 1 ? " (thin)" : ""}` : ""
      }${history ? `; past similar gaps: ${history.continued}/${history.n} kept going, ${history.filled}/${history.n} filled` : ""}`,
    };
  }

  // --- after the open: what the stock is doing with the gap ----------------------------
  const open = today[0].o;
  const day = { high: Math.max(price, ...today.map((b) => b.h)), low: Math.min(price, ...today.map((b) => b.l)) };
  const gapAtr = (open - prevClose) / atr;
  const dir = sgn(gapAtr);
  const minutes = today.length;
  const or = today.slice(0, 15);
  const range =
    minutes >= 30
      ? (() => {
          const high = Math.max(...or.map((b) => b.h));
          const low = Math.min(...or.map((b) => b.l));
          return { high, low, side: price > high ? ("above" as const) : price < low ? ("below" as const) : ("inside" as const) };
        })()
      : undefined;
  const orValue = range ? (range.side === "above" ? 0.3 : range.side === "below" ? -0.3 : 0) : 0;
  const orNote = range ? `; ${range.side === "inside" ? "inside" : range.side} the opening range ($${range.low.toFixed(2)}–$${range.high.toFixed(2)})` : "";

  if (Math.abs(gapAtr) < 0.3)
    return { ...base, phase: "open", open, day, gapPct: open / prevClose - 1, gapAtr, state: "none", range, value: orValue, note: `no meaningful gap (${pctTxt(open / prevClose - 1)} at the open)${orNote}` };

  const fill = (open - price) / (open - prevClose);
  const state = fill <= 0 ? "extending" : fill < 0.5 ? "holding" : fill < 1 ? "fading" : "filled";
  const baseValue = { extending: 0.7, holding: 0.4, fading: -0.3, filled: -0.7 }[state];
  const history = gapHistory(daily, dir, Math.abs(gapAtr));
  let value = dir * baseValue * (Math.abs(gapAtr) > 2 ? 0.6 : 1);
  if (history && history.n >= 5) value = 0.75 * value + 0.25 * dir * (2 * (history.continued / history.n) - 1);
  // the first minutes after the bell are noise; the read firms up over the first half hour
  value = clamp(value * Math.min(1, minutes / 30) + orValue);
  const words = { extending: "extending past the open", holding: "holding most of it", fading: "giving most of it back", filled: "has filled it (a failed gap)" }[state];
  return {
    ...base,
    phase: "open",
    open,
    day,
    gapPct: open / prevClose - 1,
    gapAtr,
    fill,
    state,
    range,
    history,
    value,
    note: `gapped ${dir > 0 ? "up" : "down"} ${pctTxt(open / prevClose - 1)} (${Math.abs(gapAtr).toFixed(1)}× a normal day) and is ${words}${orNote}${
      history ? `; past similar gaps: ${history.continued}/${history.n} kept going, ${history.filled}/${history.n} filled` : ""
    }`,
  };
}

/** The gap read for one symbol, for the brief. Cached for two minutes to spare the data feed. */
export function gapFor(symbol: string): Promise<GapRead | undefined> {
  return cached(`gap|${symbol}`, 120_000, async () => {
    const chart = await chartOf(symbol).catch(() => undefined);
    if (!chart) return undefined;
    const today = etDay();
    const daily = chart.daily.filter((b) => etDay(b.t) !== today);
    const todayBars = chart.bars.filter((b) => etDay(b.t) === today);
    const pre = !todayBars.length && session(new Date()).state === "Pre-market" ? await premarketOf(symbol) : [];
    const price = todayBars.at(-1)?.c ?? pre.at(-1)?.c ?? daily.at(-1)?.c ?? chart.prevClose;
    // yesterday's close from the daily bars, so the gap and the history are measured the same way
    return readGap(symbol, daily, todayBars, pre, price, daily.at(-1)?.c ?? chart.prevClose);
  });
}
