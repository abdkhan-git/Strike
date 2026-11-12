import { dteOf } from "./analytics";
import { intrinsic } from "./bs";
import { chartOf, contractOf, provider } from "./market";
import { readTrades, writeTrades } from "./store";
import type { Trade, TradeView } from "./types";
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
  const trades = await readTrades();
  if (await settleExpired(trades)) await writeTrades(trades);

  const open = trades.filter((t) => t.status === "open");
  const symbols = [...new Set(open.map((t) => t.underlying))];
  const p = provider();
  const [quotes, universe, charts] = await Promise.all([
    symbols.length ? p.quotes(symbols).catch(() => ({})) : {},
    p.universe().catch(() => []),
    Promise.all(symbols.map((s) => chartOf(s).catch(() => undefined))),
  ]);
  const chartBy = new Map(symbols.map((s, i) => [s, charts[i]]));

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
      const chart = chartBy.get(t.underlying);
      return {
        ...t,
        mark,
        pnl: (px - t.entryPrice) * 100 * t.qty,
        pnlPct: t.entryPrice > 0 ? px / t.entryPrice - 1 : 0,
        verdict:
          c && mark && spot
            ? verdictOf(t, c, spot, {
                outlook: chart?.outlook,
                trend: chart?.trend,
                catalyst: universe.find((u) => u.symbol === t.underlying)?.catalyst,
              })
            : undefined,
      };
    }),
  );
  return views.sort((a, b) => b.entryAt - a.entryAt);
}
