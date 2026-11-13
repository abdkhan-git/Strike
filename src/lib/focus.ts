import { probAbove } from "./bs";
import { cached } from "./cache";
import { marketContext } from "./context";
import { contractLabel } from "./format";
import { atr14, readGap, type GapRead } from "./gap";
import { peekBrief } from "./insights";
import { chartOf, dailyOf, premarketOf, provider, scan, signals } from "./market";
import { headlines } from "./news";
import { etDay, isTradingDay, session } from "./session";
import { readTrades } from "./store";
import { analyze } from "./thesis";
import type { SymbolSummary, Trade } from "./types";

/**
 * Ones to watch: the names most likely to make an outsized move today, which way the
 * evidence leans, and, live, whether that move is actually holding. Nothing here is a
 * certainty: it ranks how likely a big move is and how many independent sources agree.
 *
 * Two layers:
 *   selection (every 3 minutes)  which names, the direction votes and the reasons
 *   live (every 20 seconds)      price, today's range, the confirm and wrong levels, how
 *                                far the move could still run, and the status of the move
 * Any stock you hold an open position in is always on the list, judged in the direction
 * of your position.
 *
 * Move potential (0-100): the size of the gap or of today's move in normal days (ATR),
 * pre-market volume against a normal day, earnings today or last night, and option flow.
 *
 * Direction: up to five votes, each bullish, bearish or no view.
 *   gap       the gap's direction, but only where this stock's similar past gaps mostly
 *             kept going; where they mostly filled, the vote goes the other way (fade)
 *   analysis  the full analysis (trend, momentum, RSI, MACD, candles, gap, flow, market) ±20
 *   flow      the strongest one-sided option flow signal, conviction 60+
 *   news      the tone of a news digest, only if one was already written for the symbol
 *             page; this list never asks a model to write one
 *   market    the index regime, as a tailwind only
 * "Strong" needs three or more votes one way and none against, with high move potential.
 * Fewer agreeing is "Moderate"; a split is "Two-way": trade only the side that breaks.
 *
 * Status of the move, from live prices (for a bullish read; bearish is the mirror):
 *   Broken     back below yesterday's close: the move has failed
 *   Extended   it has already covered a full normal day's range from the low: late
 *   Confirmed  above the high of the opening range (or of the pre-market before 10:00)
 *   Holding    above today's average price (VWAP), not yet through the high
 *   Fading     below today's average price, giving the move back
 *
 * The gate, the way a desk grades a setup. A lean is not a trade.
 *
 * Required (all four, or it is not a trade at any size):
 *   - price has confirmed: through the opening-range level, on the right side of VWAP
 *   - not extended: under 80% of a normal day's range already used
 *   - the index is not leaning against it
 *   - inside the trading window, 9:45 am to 3:00 pm ET
 * Confluence (the more, the bigger the size):
 *   - the full analysis agrees by 30 or more
 *   - option flow agrees at conviction 60+, in size for this stock (0.02% of its normal
 *     daily dollar volume, between $150K and $2M of premium)
 *   - the stock's own gap history supports the direction (60% or better), or no gap
 *   - no reversal warning against it
 *   - relative strength: it is beating the index today in the trade's direction by 0.5%+
 * Grade: A = required + four or five of the confluence -> full plan size.
 *        B = required + two or three -> half size.
 *        C = anything else -> watch only.
 * A or B still only means "worth putting through Watch", which adds the contract's own
 * checks (price, spread, decay, payoff, size).
 *
 * How far today: ATR is a normal day's full high-to-low range. "A normal day" up is
 * today's low so far plus one ATR (down: today's high minus one ATR), "a big day" one and
 * a half. Once the day has covered a level, the levels move out from the current price.
 * The odds are of touching the level before the close, from at-the-money implied
 * volatility and the time left (twice the chance of closing beyond it). Market-implied,
 * not a forecast.
 */

export interface Reach {
  /** price at the end of a normal-sized day in this direction, and at the end of a big one */
  normal: number;
  big: number;
  normalOdds?: number;
  bigOdds?: number;
  /** the day has already covered a normal day's range in this direction */
  passed: boolean;
}

export type MoveStatus = "Pre-market" | "Confirmed" | "Holding" | "Fading" | "Broken" | "Extended" | "Broke up" | "Broke down" | "Inside the range";

export interface FocusItem {
  symbol: string;
  name?: string;
  price: number;
  changePct: number;
  gap?: Pick<GapRead, "gapPct" | "gapAtr" | "state" | "history"> & { volShare?: number };
  lean: "bullish" | "bearish" | "two-way";
  confidence: "Strong" | "Moderate" | "Two-way";
  /** 0-100: how likely an outsized move is today */
  move: number;
  votes: { source: string; vote: -1 | 0 | 1; note: string }[];
  /** the price that confirms the lean and the price that says it is wrong */
  levels: { confirm?: string; wrong?: string };
  reasons: string[];
  /** how far the move could run today, each way the lean allows */
  reach?: { up?: Reach; down?: Reach };
  catalyst?: string;
  news?: { count24h: number; tone?: string; latest?: string };
  /** the move right now, from live prices */
  live: {
    status: MoveStatus;
    tone: "up" | "down" | "warn" | "neutral";
    note: string;
    /** share of a normal day's range already covered in the direction being judged */
    used?: number;
    vsVwap?: number;
    rsi?: number;
    dayHigh?: number;
    dayLow?: number;
    asOf: number;
  };
  /** every condition, whether it is required or confluence, and whether it holds right now */
  gate: { label: string; ok: boolean; note: string; kind: "required" | "confluence" }[];
  /** A: full size. B: half size. C: watch only. */
  grade: "A" | "B" | "C";
  /** share of the plan's size this grade earns: 1, 0.5 or 0 */
  size: number;
  /** grade A or B */
  ready: boolean;
  /** you hold an open position in this stock; the status above is judged in its direction */
  held?: { label: string; qty: number; side: "bullish" | "bearish"; verdict: string };
}

/** What the slower pass decides; the live pass fills in the rest. */
type Selected = Pick<FocusItem, "symbol" | "name" | "lean" | "confidence" | "move" | "votes" | "reasons" | "catalyst" | "news"> & { iv: number; facts: Facts };

/** The raw evidence the gate is judged from, in either direction. */
interface Facts {
  score?: number;
  reversal?: { against: "bullish" | "bearish" | null; sign?: string };
  flow?: { dir: "bullish" | "bearish"; conviction: number; premium: number };
  /** premium that counts as "in size" for this stock */
  flowNeed?: number;
  gapHist?: { dir: number; rate: number; n: number };
  spy?: number;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const usd2 = (n: number) => `$${n.toFixed(2)}`;
const pct2 = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const RANK = { Strong: 0, Moderate: 1, "Two-way": 2 } as const;
const INDEX = new Set(["SPY", "QQQ", "IWM", "DIA"]);

/** Pre-market highs and lows by symbol and day, kept so they still serve as levels in the first half hour. */
const g = globalThis as { __strikePreLevels?: Map<string, { high: number; low: number }> };
const preLevels = (g.__strikePreLevels ??= new Map());

export async function focusList(): Promise<FocusItem[]> {
  const open = (await readTrades().catch((): Trade[] => [])).filter((t) => t.status === "open");
  const held = [...new Set(open.map((t) => t.underlying))].sort();
  return cached(`focus-live4|${held.join(",")}`, 20_000, () => live(open, held), { stale: true });
}

// ---------------------------------------------------------------- selection (slow)

function select(held: string[]): Promise<Selected[]> {
  return cached(`focus-sel4|${held.join(",")}`, 3 * 60_000, () => buildSelection(held), { stale: true });
}

async function buildSelection(held: string[]): Promise<Selected[]> {
  const today = etDay();
  const state = session(new Date()).state;
  const started = state === "Market open" || state === "After hours";
  const [rows, universe, sigs, ctx] = await Promise.all([
    scan()
      .then((s) => s.rows)
      .catch((): SymbolSummary[] => []),
    provider()
      .universe()
      .catch(() => []),
    signals()
      .then((s) => s.signals)
      .catch(() => []),
    marketContext().catch(() => undefined),
  ]);
  const prevDay = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    do d.setUTCDate(d.getUTCDate() - 1);
    while (!isTradingDay(d.toISOString().slice(0, 10)));
    return d.toISOString().slice(0, 10);
  })();

  // --- pass 1: a cheap read of every name (daily bars are cached; no intraday requests) ---
  const first = await Promise.all(
    rows
      .filter((r) => !INDEX.has(r.quote.symbol) || held.includes(r.quote.symbol))
      .map(async (row) => {
        const symbol = row.quote.symbol;
        let gap: GapRead | undefined;
        let size = 0;
        try {
          const daily = (await dailyOf(symbol)).filter((b) => etDay(b.t) !== today);
          if (started) {
            // after the open the size of the day's move so far stands in for the gap
            const atr = atr14(daily);
            size = atr > 0 ? Math.abs(row.quote.price - (daily.at(-1)?.c ?? row.quote.prevClose)) / atr : 0;
          } else {
            const pre = state === "Pre-market" ? await premarketOf(symbol) : [];
            gap = readGap(symbol, daily, [], pre, pre.at(-1)?.c ?? row.quote.price, daily.at(-1)?.c ?? row.quote.prevClose);
            if (gap.pre) preLevels.set(`${today}|${symbol}`, { high: gap.pre.high, low: gap.pre.low });
            size = Math.abs(gap.gapAtr);
          }
        } catch {}
        const cat = universe.find((u) => u.symbol === symbol)?.catalyst ?? row.catalyst;
        const earningsNow =
          cat?.kind === "earnings" && cat.date
            ? cat.date === today
              ? cat.label.includes("after close")
                ? "reports after the close today"
                : "reported or reports today"
              : cat.date === prevDay && cat.label.includes("after close")
                ? "reported last night after the close"
                : undefined
            : undefined;
        const flow = sigs.filter((s) => s.symbol === symbol && s.horizon !== "eod").sort((a, b) => b.conviction - a.conviction)[0];
        const vol = gap?.pre?.volShare;
        const move = Math.round(
          100 *
            clamp(
              0.5 * clamp(size) +
                0.2 * (vol === undefined ? 0 : vol >= 0.05 ? 1 : vol >= 0.02 ? 0.5 : 0) +
                0.25 * (earningsNow && earningsNow !== "reports after the close today" ? 1 : earningsNow ? 0.5 : 0) +
                0.1 * ((flow?.conviction ?? 0) / 100),
            ),
        );
        return { symbol, row, gap, earningsNow, flow, move };
      }),
  );

  const top = first
    .filter((x) => x.move >= 25 || (x.earningsNow && x.earningsNow !== "reports after the close today"))
    .sort((a, b) => b.move - a.move)
    .slice(0, 6);
  // what you hold is always judged, whatever its move potential
  const mine = first.filter((x) => held.includes(x.symbol) && !top.includes(x));

  // --- pass 2: the full read of the shortlist ---------------------------------------
  return Promise.all(
    [...mine, ...top].map(async ({ symbol, row, gap: preGap, earningsNow, flow, move }): Promise<Selected> => {
      const [a, hs, bars] = await Promise.all([analyze(symbol).catch(() => undefined), headlines(symbol).catch(() => []), dailyOf(symbol).catch(() => [])]);
      const last20 = bars.slice(-20);
      const dollarVol = last20.length ? (last20.reduce((s, b) => s + b.v, 0) / last20.length) * row.quote.price : 0;
      const gap = a?.gap ?? preGap;
      const digest = peekBrief(symbol);
      const recent = hs.filter((h) => h.at > Date.now() - 86_400_000);
      const votes: FocusItem["votes"] = [];
      const vote = (source: string, v: number, note: string) => votes.push({ source, vote: (v > 0 ? 1 : v < 0 ? -1 : 0) as -1 | 0 | 1, note });

      if (gap && Math.abs(gap.gapAtr) >= 0.3) {
        const dir = gap.gapAtr > 0 ? 1 : -1;
        if (gap.phase === "open") vote("Gap", Math.abs(gap.value) >= 0.2 ? gap.value : 0, gap.note);
        else if (gap.history && gap.history.n >= 5) {
          const rate = gap.history.continued / gap.history.n;
          vote("Gap", rate >= 0.55 ? dir : rate <= 0.45 ? -dir : 0, `${gap.note}${rate <= 0.45 ? ": this stock usually fades gaps like this" : ""}`);
        } else vote("Gap", 0, `${gap.note}; too few similar gaps on record to lean on`);
      }
      if (a) vote("Analysis", a.score >= 20 ? 1 : a.score <= -20 ? -1 : 0, `Full analysis ${a.score > 0 ? "+" : ""}${a.score}/100${a.reversal.signs.length ? `; warning: ${a.reversal.signs[0]}` : ""}`);
      if (flow && flow.conviction >= 60) vote("Options flow", flow.direction === "bullish" ? 1 : -1, `${flow.direction} flow, conviction ${flow.conviction}: ${flow.reasons[0]}`);
      if (digest && digest.tone !== "quiet") vote("News", digest.tone === "positive" ? 1 : digest.tone === "negative" ? -1 : 0, `${digest.tone} coverage: ${digest.summary}`);
      if (ctx && ctx.regime.label !== "Mixed") vote("Market", ctx.regime.label === "Uptrend" ? 1 : -1, `Index in ${ctx.regime.label === "Uptrend" ? "an uptrend" : "a downtrend"}`);

      const up = votes.filter((v) => v.vote > 0).length;
      const down = votes.filter((v) => v.vote < 0).length;
      const net = up - down;
      const lean: FocusItem["lean"] = Math.abs(net) >= 2 && Math.min(up, down) <= 1 ? (net > 0 ? "bullish" : "bearish") : "two-way";
      const agreeing = lean === "bullish" ? up : lean === "bearish" ? down : 0;
      const against = lean === "bullish" ? down : lean === "bearish" ? up : 0;
      const confidence: FocusItem["confidence"] = lean === "two-way" ? "Two-way" : agreeing >= 3 && against === 0 && move >= 45 ? "Strong" : "Moderate";

      const reasons: string[] = [];
      if (earningsNow) reasons.push(`Earnings: ${earningsNow}. Option prices drop sharply once the result is out, whichever way the stock goes.`);
      for (const v of votes) if (v.source !== "Market") reasons.push(v.note);
      if (recent[0] && !digest) reasons.push(`Latest headline (${recent[0].source}): “${recent[0].headline}”`);

      const facts: Facts = {
        score: a?.score,
        reversal: a ? { against: a.reversal.against, sign: a.reversal.signs[0] } : undefined,
        flow: flow ? { dir: flow.direction, conviction: flow.conviction, premium: flow.premium } : undefined,
        flowNeed: Math.min(2_000_000, Math.max(150_000, dollarVol * 0.0002)),
        gapHist: gap && Math.abs(gap.gapAtr) >= 0.3 && gap.history && gap.history.n >= 8 ? { dir: gap.gapAtr > 0 ? 1 : -1, rate: gap.history.continued / gap.history.n, n: gap.history.n } : undefined,
        spy: ctx?.regime.score,
      };
      return { symbol, name: row.quote.name, lean, confidence, move, votes, reasons, catalyst: earningsNow, news: { count24h: recent.length, tone: digest?.tone, latest: recent[0]?.headline }, iv: row.atmIv, facts };
    }),
  );
}

// ---------------------------------------------------------------- live (fast)

async function live(open: Trade[], held: string[]): Promise<FocusItem[]> {
  const selected = await select(held);
  if (!selected.length) return [];
  const today = etDay();
  const { state, time } = session(new Date());
  const mins = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const spyChange = (await marketContext().catch(() => undefined))?.spy?.changePct;
  const quotes = await provider()
    .quotes(selected.map((s) => s.symbol))
    .catch(() => ({}) as Record<string, { price: number; changePct: number; prevClose: number }>);

  const items = await Promise.all(
    selected.map(async (sel): Promise<FocusItem | undefined> => {
      const chart = await chartOf(sel.symbol).catch(() => undefined);
      const q = quotes[sel.symbol];
      if (!chart || !q) return undefined;
      const daily = chart.daily.filter((b) => etDay(b.t) !== today);
      const bars = chart.bars.filter((b) => etDay(b.t) === today);
      const pre = !bars.length && state === "Pre-market" ? await premarketOf(sel.symbol) : [];
      const S = bars.length ? q.price : (pre.at(-1)?.c ?? q.price);
      const prev = daily.at(-1)?.c ?? q.prevClose;
      const gap = readGap(sel.symbol, daily, bars, pre, S, prev);
      if (gap.pre) preLevels.set(`${today}|${sel.symbol}`, { high: gap.pre.high, low: gap.pre.low });
      const atr = gap.atr;
      const o = bars.length ? chart.outlook : undefined;

      // the levels that decide it: the opening range once it exists, the pre-market's until then
      const stored = preLevels.get(`${today}|${sel.symbol}`);
      const hi = gap.range?.high ?? stored?.high;
      const lo = gap.range?.low ?? stored?.low;
      const where = gap.range ? "the opening range" : "the pre-market";
      const dayHigh = Math.max(gap.day?.high ?? S, S);
      const dayLow = Math.min(gap.day?.low ?? S, S);

      // a position is judged in its own direction; otherwise the lean decides
      const mine = open.filter((t) => t.underlying === sel.symbol);
      const calls = mine.filter((t) => t.type === "call").reduce((s, t) => s + t.qty, 0);
      const puts = mine.filter((t) => t.type === "put").reduce((s, t) => s + t.qty, 0);
      const heldSide = mine.length ? (calls >= puts ? ("bullish" as const) : ("bearish" as const)) : undefined;
      const judged = heldSide ?? (sel.lean === "two-way" ? undefined : sel.lean);

      let status: MoveStatus;
      let tone: FocusItem["live"]["tone"];
      let note: string;
      let used: number | undefined;
      const vwapTxt = o ? `${pct2(o.vsVwap)} against today's average price` : "";
      if (!bars.length) {
        status = "Pre-market";
        tone = "neutral";
        note = `${pct2(S / prev - 1)} before the open at ${usd2(S)}. Nothing is confirmed until it trades after 9:30.`;
      } else if (judged) {
        const dir = judged === "bullish" ? 1 : -1;
        used = atr > 0 ? (dir > 0 ? S - dayLow : dayHigh - S) / atr : undefined;
        const level = dir > 0 ? hi : lo;
        const through = level !== undefined && (dir > 0 ? S > level : S < level);
        const wrongSide = dir > 0 ? S < prev : S > prev;
        const rightOfVwap = o ? o.vsVwap * dir >= 0 : true;
        const pulled = atr > 0 ? (dir > 0 ? dayHigh - S : S - dayLow) / atr : 0;
        const word = dir > 0 ? "rally" : "sell-off";
        if (wrongSide && Math.abs(gap.gapAtr) >= 0.3 && Math.sign(gap.gapAtr) === dir) {
          status = "Broken";
          tone = "down";
          note = `The ${word} has failed: ${sel.symbol} is back ${dir > 0 ? "below" : "above"} yesterday's close of ${usd2(prev)}${vwapTxt ? `, ${vwapTxt}` : ""}.`;
        } else if (used !== undefined && used >= 1) {
          status = "Extended";
          tone = "warn";
          note = `The ${word} has already covered ${used.toFixed(1)}× a normal day's range from the ${dir > 0 ? "low" : "high"}. It can run further, but the easy part is done: this is late to enter and time to protect a gain.`;
        } else if (through && rightOfVwap) {
          status = "Confirmed";
          tone = "up";
          note = `Holding ${dir > 0 ? "above" : "below"} ${usd2(level!)} (${dir > 0 ? "high" : "low"} of ${where})${vwapTxt ? `, ${vwapTxt}` : ""}. ${used !== undefined ? `${(used * 100).toFixed(0)}% of a normal day's range used.` : ""}`;
        } else if (rightOfVwap && !wrongSide) {
          status = "Holding";
          tone = "neutral";
          note = `On the right side of today's average price (${vwapTxt || "no average yet"}) but not through ${level !== undefined ? usd2(level) : "the range"} yet${pulled >= 0.25 ? `, and ${pulled.toFixed(1)}× a normal day off the ${dir > 0 ? "high" : "low"}` : ""}.`;
        } else {
          status = wrongSide ? "Broken" : "Fading";
          tone = wrongSide ? "down" : "warn";
          note = wrongSide
            ? `${sel.symbol} is on the wrong side of yesterday's close (${usd2(prev)})${vwapTxt ? ` and ${vwapTxt}` : ""}: there is no ${word} to hold.`
            : `The ${word} is fading: ${vwapTxt || "below the day's average"}${o ? `, RSI ${o.rsi.toFixed(0)}` : ""}, ${pulled.toFixed(1)}× a normal day off the ${dir > 0 ? "high" : "low"}.`;
        }
      } else if (hi !== undefined && S > hi) {
        status = "Broke up";
        tone = "up";
        note = `Through ${usd2(hi)} (high of ${where})${vwapTxt ? `, ${vwapTxt}` : ""}. The upside is the side to trade while it holds above.`;
      } else if (lo !== undefined && S < lo) {
        status = "Broke down";
        tone = "down";
        note = `Through ${usd2(lo)} (low of ${where})${vwapTxt ? `, ${vwapTxt}` : ""}. The downside is the side to trade while it holds below.`;
      } else {
        status = "Inside the range";
        tone = "neutral";
        note = hi !== undefined && lo !== undefined ? `Between ${usd2(lo)} and ${usd2(hi)}: no direction yet.` : "No direction yet.";
      }

      const lean = sel.lean;
      const levels: FocusItem["levels"] =
        lean === "bullish"
          ? { confirm: hi !== undefined ? `Holds above ${usd2(hi)} (high of ${where})` : `Holds above ${usd2(prev)}`, wrong: `Back below ${usd2(prev)} (yesterday's close)` }
          : lean === "bearish"
            ? { confirm: lo !== undefined ? `Stays below ${usd2(lo)} (low of ${where})` : `Stays below ${usd2(prev)}`, wrong: `Back above ${usd2(prev)} (yesterday's close)` }
            : { confirm: hi !== undefined && lo !== undefined ? `Trade only the side that breaks: above ${usd2(hi)} or below ${usd2(lo)}` : "Wait for a direction after 9:45" };

      // how far today, from today's range, with the options market's odds of touching each level
      const minsLeft = state === "Market open" ? Math.max(15, 960 - mins) : 390;
      const T = minsLeft / 390 / 252;
      const side = (dir: 1 | -1): Reach | undefined => {
        if (!(atr > 0) || !(S > 0)) return undefined;
        const from = dir > 0 ? dayLow : dayHigh;
        const normal0 = from + dir * atr;
        const passed = dir > 0 ? dayHigh >= normal0 : dayLow <= normal0;
        const normal = passed ? S + dir * 0.5 * atr : normal0;
        const big = passed ? S + dir * atr : from + dir * 1.5 * atr;
        const touch = (t: number) => (sel.iv > 0 ? Math.min(0.99, 2 * (dir > 0 ? probAbove(S, t, T, sel.iv) : 1 - probAbove(S, t, T, sel.iv))) : undefined);
        return { normal, big, normalOdds: touch(normal), bigOdds: touch(big), passed };
      };
      const way = judged ?? lean;
      const reach = way === "bullish" ? { up: side(1) } : way === "bearish" ? { down: side(-1) } : { up: side(1), down: side(-1) };

      // the gate: what is required, what adds confidence, and the grade that follows
      const gate: FocusItem["gate"] = [];
      const must = (label: string, ok: boolean, note: string) => gate.push({ label, ok, note, kind: "required" });
      const plus = (label: string, ok: boolean, note: string) => gate.push({ label, ok, note, kind: "confluence" });
      const f: Facts = sel.facts ?? {};
      if (!judged) must("An agreed direction", false, "The evidence is split: there is nothing to trade until one side wins.");
      else {
        const d = judged === "bullish" ? 1 : -1;
        const level = d > 0 ? hi : lo;
        must("Price has confirmed", status === "Confirmed", status === "Confirmed" ? note : `status is “${status}”; needs to be through ${level !== undefined ? usd2(level) : "the opening range"} and on the right side of the average price`);
        must("Not extended", used !== undefined && used < 0.8, used !== undefined ? `${Math.round(used * 100)}% of a normal day's range used; needs under 80%` : "not trading yet");
        must("Market is not against it", (f.spy ?? 0) * d >= 0, `SPY analysis ${(f.spy ?? 0) > 0 ? "+" : ""}${f.spy ?? 0}`);
        must("Inside the trading window", state === "Market open" && mins >= 585 && mins < 900, `${time}; window is 9:45 am to 3:00 pm ET`);

        plus("Full analysis agrees", f.score !== undefined && f.score * d >= 30, f.score !== undefined ? `${f.score > 0 ? "+" : ""}${f.score}/100; needs ${d > 0 ? "+30 or more" : "−30 or less"}` : "no analysis");
        const needM = (f.flowNeed ?? 1_000_000) / 1e6;
        plus(
          "Option flow agrees, in size",
          !!f.flow && f.flow.dir === judged && f.flow.conviction >= 60 && f.flow.premium >= (f.flowNeed ?? 1_000_000),
          f.flow ? `${f.flow.dir}, conviction ${f.flow.conviction}, $${(f.flow.premium / 1e6).toFixed(1)}M premium; needs ${judged}, 60+, $${needM.toFixed(needM < 1 ? 2 : 1)}M+ for this stock` : "no one-sided flow today",
        );
        plus(
          "Gap history supports it",
          !f.gapHist || (f.gapHist.dir === d ? f.gapHist.rate >= 0.6 : f.gapHist.rate <= 0.4),
          f.gapHist ? `similar gaps kept going ${Math.round(f.gapHist.rate * 100)}% of ${f.gapHist.n} times; needs ${f.gapHist.dir === d ? "60% or more" : "40% or less (a fade)"}` : "no meaningful gap, or too few on record to count against it",
        );
        plus("No reversal warning", f.reversal?.against !== judged, f.reversal?.against === judged ? (f.reversal.sign ?? "warning against this direction") : "none");
        const change = prev > 0 ? S / prev - 1 : 0;
        const rs = spyChange !== undefined ? (change - spyChange) * d : undefined;
        plus("Stronger than the market", rs !== undefined && rs >= 0.005, rs !== undefined ? `${pct2(change)} today against SPY ${pct2(spyChange!)}; needs to lead by 0.5% in this direction` : "no index read");
      }
      const required = gate.filter((x) => x.kind === "required");
      const confluence = gate.filter((x) => x.kind === "confluence" && x.ok).length;
      const grade: FocusItem["grade"] = !judged || !required.every((x) => x.ok) ? "C" : confluence >= 4 ? "A" : confluence >= 2 ? "B" : "C";
      const size = grade === "A" ? 1 : grade === "B" ? 0.5 : 0;

      const heldInfo: FocusItem["held"] = heldSide
        ? {
            label: mine.map((t) => `${t.qty} × ${contractLabel(t)}`).join(", "),
            qty: calls + puts,
            side: heldSide,
            verdict:
              status === "Confirmed" || status === "Holding"
                ? `The move still supports your ${heldSide === "bullish" ? "calls" : "puts"}.`
                : status === "Extended"
                  ? "The move has gone a full normal day your way: check Positions for the take-profit call rather than hoping for more."
                  : status === "Pre-market"
                    ? "Wait for the open before judging it."
                    : `The move is ${status === "Broken" ? "broken" : "fading"} against your ${heldSide === "bullish" ? "calls" : "puts"}: the sell or hold call in Positions decides, and it uses your stop and invalidation price.`,
          }
        : undefined;

      const { iv: _iv, ...rest } = sel;
      void _iv;
      return {
        ...rest,
        price: S,
        changePct: prev > 0 ? S / prev - 1 : q.changePct,
        gap: { gapPct: gap.gapPct, gapAtr: gap.gapAtr, state: gap.state, history: gap.history, volShare: gap.pre?.volShare },
        levels,
        reach,
        live: { status, tone, note, used, vsVwap: o?.vsVwap, rsi: o?.rsi, dayHigh, dayLow, asOf: Date.now() },
        gate,
        grade,
        size,
        ready: grade !== "C",
        held: heldInfo,
      };
    }),
  );

  return items
    .filter((x): x is FocusItem => !!x)
    .sort((x, y) => Number(!!y.held) - Number(!!x.held) || y.size - x.size || y.gate.filter((c) => c.ok).length / y.gate.length - x.gate.filter((c) => c.ok).length / x.gate.length || RANK[x.confidence] - RANK[y.confidence] || y.move - x.move)
    .slice(0, 6 + held.length);
}
