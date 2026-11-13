import { cached } from "./cache";
import { marketContext } from "./context";
import { gapFor, readGap, type GapRead } from "./gap";
import { dailyOf, premarketOf, provider, scan, signals } from "./market";
import { headlines } from "./news";
import { newsFor } from "./insights";
import { etDay, isTradingDay, session } from "./session";
import { analyze } from "./thesis";
import type { SymbolSummary } from "./types";

/**
 * Ones to watch: the names most likely to make an outsized move today, and which way the
 * evidence leans. Nothing here is a certainty: it ranks how likely a big move is and how
 * many independent sources agree on its direction.
 *
 * Move potential (0-100): the size of the gap in normal days (ATR), pre-market volume
 * against a normal day, earnings landing today or last night, a burst of headlines, and
 * strong option flow.
 *
 * Direction: up to five votes, each bullish, bearish or no view.
 *   gap       the gap's direction, but only where this stock's similar past gaps mostly
 *             kept going; where they mostly filled, the vote goes the other way (fade)
 *   analysis  the full analysis (trend, momentum, RSI, MACD, candles, flow, market) ±20
 *   flow      the strongest one-sided option flow signal, conviction 60+
 *   news      the tone of the model-written news digest
 *   market    the index regime, as a tailwind only
 * "Strong" needs three or more votes in one direction and none against, with a high move
 * potential. With fewer agreeing it is "Moderate", and a split is "Two-way": a big move is
 * likely but the direction is not, so only the side that breaks after the open is traded.
 *
 * News covers what is reported in headlines (Finnhub). Rumours count only once reported.
 */

export interface FocusItem {
  symbol: string;
  name?: string;
  price: number;
  gap?: Pick<GapRead, "gapPct" | "gapAtr" | "state" | "history"> & { volShare?: number };
  lean: "bullish" | "bearish" | "two-way";
  confidence: "Strong" | "Moderate" | "Two-way";
  /** 0-100: how likely an outsized move is today */
  move: number;
  votes: { source: string; vote: -1 | 0 | 1; note: string }[];
  /** the price that confirms the lean and the price that says it is wrong */
  levels: { confirm?: string; wrong?: string };
  reasons: string[];
  catalyst?: string;
  news?: { count24h: number; tone?: string; summary?: string; latest?: string };
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const usd2 = (n: number) => `$${n.toFixed(2)}`;
const RANK = { Strong: 0, Moderate: 1, "Two-way": 2 } as const;

export function focusList(): Promise<FocusItem[]> {
  return cached("focus", 5 * 60_000, build, { stale: true });
}

async function build(): Promise<FocusItem[]> {
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
  const skip = new Set(["SPY", "QQQ", "IWM", "DIA"]);
  const names = rows.map((r) => r.quote.symbol).filter((s) => !skip.has(s));

  // --- pass 1: cheap read of every name --------------------------------------------
  const first = await Promise.all(
    names.map(async (symbol) => {
      const row = rows.find((r) => r.quote.symbol === symbol)!;
      let gap: GapRead | undefined;
      try {
        if (started) gap = await gapFor(symbol);
        else {
          const all = await dailyOf(symbol);
          const daily = all.filter((b) => etDay(b.t) !== today);
          const pre = state === "Pre-market" ? await premarketOf(symbol) : [];
          gap = readGap(symbol, daily, [], pre, pre.at(-1)?.c ?? row.quote.price, daily.at(-1)?.c ?? row.quote.prevClose);
        }
      } catch {}
      const cat = universe.find((u) => u.symbol === symbol)?.catalyst ?? row.catalyst;
      // earnings that move today: reported last night after the close, this morning, or today
      const prevDay = (() => {
        const d = new Date(`${today}T12:00:00Z`);
        do d.setUTCDate(d.getUTCDate() - 1);
        while (!isTradingDay(d.toISOString().slice(0, 10)));
        return d.toISOString().slice(0, 10);
      })();
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
      const gapSize = gap ? Math.abs(gap.gapAtr) : 0;
      const vol = gap?.pre?.volShare;
      const move = Math.round(
        100 *
          clamp(
            0.45 * clamp(gapSize / 1) +
              0.2 * (vol === undefined ? 0 : vol >= 0.05 ? 1 : vol >= 0.02 ? 0.5 : 0) +
              0.25 * (earningsNow && earningsNow !== "reports after the close today" ? 1 : earningsNow ? 0.5 : 0) +
              0.1 * ((flow?.conviction ?? 0) / 100) +
              (started ? 0.15 * clamp(Math.abs(row.quote.changePct) / Math.max(row.expectedMovePct, 0.01)) : 0),
          ),
      );
      return { symbol, row, gap, earningsNow, flow, move };
    }),
  );

  const shortlist = first
    .filter((x) => x.move >= 25 || (x.earningsNow && x.earningsNow !== "reports after the close today"))
    .sort((a, b) => b.move - a.move)
    .slice(0, 8);

  // --- pass 2: full read of the shortlist ------------------------------------------
  const items = await Promise.all(
    shortlist.map(async ({ symbol, row, gap, earningsNow, flow, move }): Promise<FocusItem> => {
      const [a, hs, digest] = await Promise.all([analyze(symbol).catch(() => undefined), headlines(symbol).catch(() => []), newsFor(symbol).catch(() => undefined)]);
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
      if (digest?.brief && digest.brief.tone !== "quiet")
        vote("News", digest.brief.tone === "positive" ? 1 : digest.brief.tone === "negative" ? -1 : 0, `${digest.brief.tone} coverage: ${digest.brief.summary}`);
      if (ctx && ctx.regime.label !== "Mixed") vote("Market", ctx.regime.label === "Uptrend" ? 1 : -1, `Index in ${ctx.regime.label === "Uptrend" ? "an uptrend" : "a downtrend"}`);

      const up = votes.filter((v) => v.vote > 0).length;
      const down = votes.filter((v) => v.vote < 0).length;
      const net = up - down;
      const lean: FocusItem["lean"] = Math.abs(net) >= 2 && Math.min(up, down) <= 1 ? (net > 0 ? "bullish" : "bearish") : "two-way";
      const agreeing = lean === "bullish" ? up : lean === "bearish" ? down : 0;
      const against = lean === "bullish" ? down : lean === "bearish" ? up : 0;
      const confidence: FocusItem["confidence"] = lean === "two-way" ? "Two-way" : agreeing >= 3 && against === 0 && move >= 45 ? "Strong" : "Moderate";

      // levels: the side that confirms the lean, and the price that says it is wrong
      const prev = gap?.prevClose ?? row.quote.prevClose;
      const hi = gap?.range?.high ?? gap?.pre?.high;
      const lo = gap?.range?.low ?? gap?.pre?.low;
      const where = gap?.range ? "the opening range" : gap?.pre ? "the pre-market" : "yesterday's range";
      const levels: FocusItem["levels"] =
        lean === "bullish"
          ? { confirm: hi ? `Holds above ${usd2(hi)} (high of ${where}) after 9:45` : `Holds above ${usd2(prev)} after 9:45`, wrong: `Back below ${usd2(prev)} (yesterday's close)` }
          : lean === "bearish"
            ? { confirm: lo ? `Stays below ${usd2(lo)} (low of ${where}) after 9:45` : `Stays below ${usd2(prev)} after 9:45`, wrong: `Back above ${usd2(prev)} (yesterday's close)` }
            : { confirm: hi && lo ? `Trade only the side that breaks after 9:45: above ${usd2(hi)} or below ${usd2(lo)}` : "Wait for a direction after 9:45", wrong: undefined };

      const reasons: string[] = [];
      if (earningsNow) reasons.push(`Earnings: ${earningsNow}. Option prices drop sharply once the result is out, whichever way the stock goes.`);
      for (const v of votes) if (v.source !== "Market") reasons.push(v.note);
      if (recent.length >= 3 && !digest?.brief) reasons.push(`${recent.length} headlines in the last day; latest: “${recent[0].headline}”`);

      return {
        symbol,
        name: row.quote.name,
        price: gap?.pre?.last ?? row.quote.price,
        gap: gap ? { gapPct: gap.gapPct, gapAtr: gap.gapAtr, state: gap.state, history: gap.history, volShare: gap.pre?.volShare } : undefined,
        lean,
        confidence,
        move,
        votes,
        levels,
        reasons,
        catalyst: earningsNow,
        news: { count24h: recent.length, tone: digest?.brief?.tone, summary: digest?.brief?.summary, latest: recent[0]?.headline },
      };
    }),
  );

  return items.sort((x, y) => RANK[x.confidence] - RANK[y.confidence] || y.move - x.move).slice(0, 6);
}

