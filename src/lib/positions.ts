import { dteOf } from "./analytics";
import { syncFromBroker } from "./broker";
import { intrinsic } from "./bs";
import { chartOf, contractOf, provider } from "./market";
import { readTheses, readTrades, writeTheses, writeTrades } from "./store";
import { analyze, type Analysis } from "./thesis";
import type { Thesis, Trade, TradeView, Verdict } from "./types";
import { verdictOf } from "./verdict";

/**
 * Closes positions whose expiration has passed at their intrinsic value, using the
 * stock's closing price on expiration day (or the current price if that bar is missing).
 */
async function settleExpired(trades: Trade[]) {
  const expired = trades.filter((t) => t.status === "open" && dteOf(t.expiration) === 0);
  if (!expired.length) return false;
  for (const t of expired) {
    let close: number | undefined;
    try {
      const chart = await chartOf(t.underlying);
      const day = chart.daily.find((b) => new Date(b.t).toISOString().slice(0, 10) === t.expiration);
      close = day?.c ?? chart.bars.at(-1)?.c ?? chart.prevClose;
    } catch {
      continue; // no price available: leave it open and try again next time
    }
    if (!close) continue;
    t.status = "closed";
    t.exitPrice = +intrinsic(t.type, close, t.strike).toFixed(2);
    t.exitAt = Date.parse(t.expiration + "T21:00:00Z");
    t.note = [t.note, `Expired with the stock at ${close.toFixed(2)}`].filter(Boolean).join(" · ");
  }
  return true;
}

/** Every logged trade, with open ones marked at the live mid price and given a verdict. */
export async function tradeViews(): Promise<TradeView[]> {
  // brokerage fills are the source of truth for anything traded there (at most once a minute)
  // Runs in the background so the page never waits on SnapTrade; the next poll (5 s) shows
  // anything it changed. Only the very first sync, with nothing from the broker yet, is awaited.
  const syncing = syncFromBroker().catch((e) => console.warn("[broker] sync failed:", e instanceof Error ? e.message : e));
  let trades = await readTrades();
  if (!trades.some((t) => t.source === "broker")) {
    await syncing;
    trades = await readTrades();
  }
  if (await settleExpired(trades)) await writeTrades(trades);

  const open = trades.filter((t) => t.status === "open");
  const symbols = [...new Set(open.map((t) => t.underlying))];
  const p = provider();
  const [quotes, universe, analyses, theses] = await Promise.all([
    symbols.length ? p.quotes(symbols).catch(() => ({})) : {},
    p.universe().catch(() => []),
    Promise.all(symbols.map((s) => analyze(s).catch(() => undefined))),
    readTheses(),
  ]);
  const analysisBy = new Map(symbols.map((s, i) => [s, analyses[i]]));
  const thesisBy = new Map(theses.map((t) => [t.occ, t]));
  const created = await ensureTheses(open, analysisBy, thesisBy);
  if (created.length) await writeTheses([...theses, ...created].slice(-300));

  const views: TradeView[] = await Promise.all(
    trades.map(async (t) => {
      if (t.status === "closed") {
        const px = t.exitPrice ?? 0;
        return { ...t, pnl: (px - t.entryPrice) * 100 * t.qty, pnlPct: t.entryPrice > 0 ? px / t.entryPrice - 1 : 0 };
      }
      const spot = (quotes as Record<string, { price: number }>)[t.underlying]?.price;
      const c = spot ? await contractOf(t.underlying, t.expiration, t.occ, spot) : undefined;
      const mark = c && c.mid > 0 ? c.mid : undefined;
      const px = mark ?? t.entryPrice;
      const analysis = analysisBy.get(t.underlying);
      return {
        ...t,
        mark,
        pnl: (px - t.entryPrice) * 100 * t.qty,
        pnlPct: t.entryPrice > 0 ? px / t.entryPrice - 1 : 0,
        verdict:
          c && mark && spot
            ? steady(
                t.id,
                verdictOf(t, c, spot, {
                  analysis,
                  thesis: thesisBy.get(t.occ),
                  catalyst: universe.find((u) => u.symbol === t.underlying)?.catalyst,
                }),
              )
            : undefined,
      };
    }),
  );
  return views.sort((a, b) => b.entryAt - a.entryAt);
}

/**
 * A thesis for every open position. Picks carry their own; anything else (a trade made
 * outside the picks) gets one from the full analysis the first time it is seen: the case
 * is whatever the analysis says, and it is wrong once the stock passes the nearest
 * support (calls) or resistance (puts) by a quarter of a day's average range.
 */
async function ensureTheses(open: Trade[], analysisBy: Map<string, Analysis | undefined>, thesisBy: Map<string, Thesis>) {
  const made: Thesis[] = [];
  for (const t of open) {
    if (thesisBy.has(t.occ)) continue;
    const a = analysisBy.get(t.underlying);
    if (!a) continue;
    const call = t.type === "call";
    const inv = call ? a.levels.support - 0.25 * a.levels.atr : a.levels.resistance + 0.25 * a.levels.atr;
    const th: Thesis = {
      occ: t.occ,
      symbol: t.underlying,
      direction: call ? "bullish" : "bearish",
      text: `${call ? "Bullish" : "Bearish"} ${t.underlying}: opened outside the picks; the full analysis was ${a.score > 0 ? "+" : ""}${a.score}/100 when Strike first saw it.`,
      invalidation: Math.round(inv * 100) / 100,
      invalidationReason: call ? "below the nearest support" : "above the nearest resistance",
      scoreAtEntry: a.score,
      at: Date.now(),
      source: "auto",
    };
    thesisBy.set(t.occ, th);
    made.push(th);
  }
  return made;
}

/**
 * Keeps a judgement call from flickering. Hard exits (target, stop, thesis broken, time)
 * show at once; any other change of call must hold for 90 seconds before it is shown.
 */
const g = globalThis as { __strikeCalls?: Map<string, { shown: Verdict; pending?: { call: string; since: number } }> };
const calls = (g.__strikeCalls ??= new Map());
const CONFIRM_MS = 90_000;

function steady(id: string, v: Verdict): Verdict {
  const prev = calls.get(id);
  if (!prev || v.urgent || prev.shown.call === v.call) {
    calls.set(id, { shown: v });
    return v;
  }
  const pending = prev.pending?.call === v.call ? prev.pending : { call: v.call, since: Date.now() };
  if (Date.now() - pending.since >= CONFIRM_MS) {
    calls.set(id, { shown: v });
    return v;
  }
  calls.set(id, { shown: prev.shown, pending });
  // keep the earlier call but with today's numbers, so prices and P/L stay live
  return { ...v, call: prev.shown.call, headline: prev.shown.headline, move: prev.shown.move, quality: prev.shown.quality, tone: prev.shown.tone, action: prev.shown.action, doNow: prev.shown.doNow };
}
