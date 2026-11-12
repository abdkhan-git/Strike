import { popLong } from "./bs";
import { pct, shortDate, signedPct, usd } from "./format";
import type { Catalyst, Enriched, Outlook, Trade, Trend, Verdict } from "./types";

/**
 * What to do with an open long option right now. Fixed rules, checked in order, over
 * live inputs: profit or loss against the entry, days left, how fast time value is
 * decaying, the market-implied odds of finishing above the entry price, the stock's
 * near-term momentum and trend, and any earnings date before expiry. The first rule
 * that fires sets the action; every input that mattered is listed as a reason.
 *
 * The thresholds are common discretionary practice for long premium (take profit at a
 * double, cut at half when time is short), not a fitted model.
 */
export function verdictOf(
  t: Trade,
  c: Enriched,
  spot: number,
  ctx: { outlook?: Outlook; trend?: Trend; catalyst?: Catalyst },
): Verdict {
  const mark = c.mid;
  const pnlPct = t.entryPrice > 0 ? mark / t.entryPrice - 1 : 0;
  const dte = c.dte;
  const days = Math.max(0, Math.round(dte));
  const call = t.type === "call";
  const otm = call ? spot < t.strike : spot > t.strike;
  const odds = c.iv > 0 ? popLong(t.type, spot, t.strike, t.entryPrice, dte / 365, c.iv) : 0;
  // a day of decay can never cost more than what is left of the premium
  const decay = Math.min(Math.abs(c.theta), mark);
  const decayPerDay = decay * 100 * t.qty;
  const decayShare = mark > 0 ? decay / mark : 0;
  const be = call ? t.strike + t.entryPrice : t.strike - t.entryPrice;

  const lean = ctx.outlook?.lean ?? "flat";
  const withIt = (call && lean === "up") || (!call && lean === "down");
  const against = (call && lean === "down") || (!call && lean === "up");
  const trendWith = ctx.trend ? (call ? ctx.trend.vsSma20 > 0 : ctx.trend.vsSma20 < 0) : undefined;
  const earnings =
    ctx.catalyst?.kind === "earnings" && ctx.catalyst.date && ctx.catalyst.date <= t.expiration ? ctx.catalyst.date : undefined;
  const daysToEarnings = earnings ? Math.round((Date.parse(earnings + "T21:00:00Z") - Date.now()) / 86_400_000) : undefined;

  const reasons: string[] = [
    `${pnlPct >= 0 ? "Up" : "Down"} ${pct(Math.abs(pnlPct), 0)} on the premium, ${days} day${days === 1 ? "" : "s"} to expiry`,
    `${pct(odds, 0)} implied odds the stock is past your ${usd(be)} break-even at expiry (now ${usd(spot)})`,
    `Time decay costs about ${usd(decayPerDay)} a day (${pct(decayShare, 0)} of the position)`,
  ];
  if (ctx.outlook)
    reasons.push(
      lean === "flat"
        ? "No near-term momentum either way"
        : `Near-term momentum is ${withIt ? "with" : "against"} the position (${signedPct(ctx.outlook.ret15)} in 15 minutes)`,
    );
  if (ctx.trend)
    reasons.push(`Stock is ${signedPct(ctx.trend.vsSma20, 1)} against its 20-day average, ${trendWith ? "in" : "against"} your direction`);
  if (earnings) reasons.push(`Earnings ${shortDate(earnings)} falls before expiry; implied vol usually drops right after`);

  const base = { reasons, odds, decayPerDay, dte, target: t.entryPrice * 2, stop: t.entryPrice * 0.5 };
  const say = (action: Verdict["action"], tone: Verdict["tone"], headline: string): Verdict => ({ action, tone, headline, ...base });

  if (pnlPct >= 1)
    return say(
      "Take profit",
      "up",
      `The premium has at least doubled. Selling half takes your original stake off the table and leaves the rest riding at no risk.`,
    );
  if (pnlPct >= 0.5 && (against || days <= 3))
    return say(
      "Take profit",
      "up",
      against
        ? `Up ${pct(pnlPct, 0)} and momentum has turned against the position. Banking the gain now is the higher-odds choice.`
        : `Up ${pct(pnlPct, 0)} with ${days} day${days === 1 ? "" : "s"} left; time decay accelerates from here, so the gain is at its most fragile.`,
    );
  if (days <= 1 && otm)
    return say(
      "Sell",
      "down",
      `Expires ${days === 0 ? "today" : "tomorrow"} out of the money. Whatever premium is left decays to zero unless the stock moves ${signedPct(t.strike / spot - 1, 1)}.`,
    );
  if (pnlPct <= -0.5 && (days <= 5 || odds < 0.15))
    return say(
      "Sell",
      "down",
      `Down ${pct(-pnlPct, 0)} with ${pct(odds, 0)} implied odds of recovering the entry price. Selling keeps the ${usd(mark * 100 * t.qty)} that is left.`,
    );
  if (daysToEarnings !== undefined && daysToEarnings <= 1 && daysToEarnings >= 0 && pnlPct >= 0.2)
    return say(
      "Trim",
      "warn",
      `Earnings ${daysToEarnings === 0 ? "today" : "tomorrow"} and you are up ${pct(pnlPct, 0)}. Selling part locks a gain before the post-earnings drop in implied vol.`,
    );
  if (decayShare >= 0.08 && !withIt)
    return say(
      "Trim",
      "warn",
      `Time decay is taking ${pct(decayShare, 0)} of the position a day and momentum is not paying for it. Reduce size or exit unless you expect a move soon.`,
    );
  if (withIt)
    return say(
      "Hold",
      "up",
      `Momentum is with the position and no exit rule has triggered. Next decision points: ${usd(base.target)} (double) or ${usd(base.stop)} (half).`,
    );
  if (against && pnlPct < 0)
    return say(
      "Wait",
      "neutral",
      `Momentum is against the position but no exit rule has triggered. Hold for now; sell if the premium falls to ${usd(base.stop)}.`,
    );
  return say(
    "Hold",
    "neutral",
    `No exit rule has triggered. Next decision points: ${usd(base.target)} (double) or ${usd(base.stop)} (half).`,
  );
}
