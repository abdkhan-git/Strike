import { popLong, probAbove } from "./bs";
import { pct, shortDate, signedPct, usd } from "./format";
import type { Catalyst, Enriched, Outlook, Trade, Trend, Verdict } from "./types";

/**
 * A direct call on an open long option: is it a good or bad position, and should you
 * sell it, take some off, or keep it right now.
 *
 * Fixed rules, checked in order, over live inputs: profit or loss against the entry,
 * days left, how fast time value is decaying, the market-implied odds of finishing past
 * break-even and of the premium doubling, near-term momentum, the 20-day trend, and any
 * earnings date before expiry. The thresholds are standard discretionary practice for
 * bought options (bank a double, cut at half when time is short, never let a winner
 * expire worthless), not a fitted model.
 */
export function verdictOf(
  t: Trade,
  c: Enriched,
  spot: number,
  ctx: { outlook?: Outlook; trend?: Trend; catalyst?: Catalyst },
): Verdict {
  const mark = c.mid;
  const pnlPct = t.entryPrice > 0 ? mark / t.entryPrice - 1 : 0;
  const up = pnlPct >= 0;
  const dte = c.dte;
  const days = Math.max(0, Math.round(dte));
  const T = dte / 365;
  const call = t.type === "call";
  const otm = call ? spot < t.strike : spot > t.strike;
  const be = call ? t.strike + t.entryPrice : t.strike - t.entryPrice;
  const odds = c.iv > 0 ? popLong(t.type, spot, t.strike, t.entryPrice, T, c.iv) : 0;

  // stock level where the option is worth double the entry at expiry; touching it before
  // expiry is about twice as likely as finishing past it (reflection principle)
  const doubleLevel = call ? t.strike + 2 * t.entryPrice : t.strike - 2 * t.entryPrice;
  const finishPast = c.iv > 0 && doubleLevel > 0 ? probAbove(spot, doubleLevel, T, c.iv) : 0;
  const doubleOdds = pnlPct >= 1 ? 1 : Math.min(1, 2 * (call ? finishPast : 1 - finishPast));

  // a day of decay can never cost more than what is left of the premium
  const decay = Math.min(Math.abs(c.theta), mark);
  const decayPerDay = decay * 100 * t.qty;
  const decayShare = mark > 0 ? decay / mark : 0;

  const lean = ctx.outlook?.lean ?? "flat";
  const withIt = (call && lean === "up") || (!call && lean === "down");
  const against = (call && lean === "down") || (!call && lean === "up");
  const trendWith = ctx.trend ? (call ? ctx.trend.vsSma20 > 0 : ctx.trend.vsSma20 < 0) : undefined;
  const earnings =
    ctx.catalyst?.kind === "earnings" && ctx.catalyst.date && ctx.catalyst.date <= t.expiration ? ctx.catalyst.date : undefined;
  const daysToEarnings = earnings ? Math.round((Date.parse(earnings + "T21:00:00Z") - Date.now()) / 86_400_000) : undefined;
  const value = mark * 100 * t.qty;
  const gain = (mark - t.entryPrice) * 100 * t.qty;

  const reasons: string[] = [
    `${up ? "Up" : "Down"} ${pct(Math.abs(pnlPct), 0)} (${gain >= 0 ? "+" : "-"}${usd(Math.abs(gain), 0)}), ${days} day${days === 1 ? "" : "s"} to expiry`,
    `${pct(odds, 0)} odds the stock is past your ${usd(be)} break-even at expiry (now ${usd(spot)})`,
    pnlPct >= 1
      ? "The premium has already doubled"
      : `${pct(doubleOdds, 0)} odds the premium doubles before expiry (stock at ${usd(doubleLevel)})`,
    `Time decay costs ${usd(decayPerDay, 0)} a day, ${pct(decayShare, 0)} of what the position is worth`,
  ];
  if (ctx.outlook)
    reasons.push(
      lean === "flat"
        ? "No short-term momentum either way"
        : `Short-term momentum is ${withIt ? "with" : "against"} you (${signedPct(ctx.outlook.ret15)} in 15 minutes)`,
    );
  if (ctx.trend) reasons.push(`Stock is ${signedPct(ctx.trend.vsSma20, 1)} vs its 20-day average, ${trendWith ? "with" : "against"} your direction`);
  if (earnings) reasons.push(`Earnings ${shortDate(earnings)} lands before expiry; implied vol usually drops right after`);

  const base = { reasons, odds, doubleOdds, decayPerDay, dte, target: t.entryPrice * 2, stop: t.entryPrice * 0.5 };
  const say = (
    action: Verdict["action"],
    move: Verdict["move"],
    quality: Verdict["quality"],
    callText: string,
    headline: string,
  ): Verdict => ({
    action,
    move,
    quality,
    call: callText,
    tone: quality === "bad" ? "down" : move === "keep" ? (quality === "good" ? "up" : "neutral") : quality === "good" ? "up" : "warn",
    headline,
    ...base,
  });

  if (pnlPct >= 1)
    return say(
      "Take profit",
      "sell-half",
      "good",
      "Good position, sell half now",
      `It has doubled. Selling half gets your whole stake back and the rest rides for free.`,
    );
  if (days <= 1 && otm)
    return up
      ? say(
          "Sell",
          "sell",
          "good",
          "Good position, sell now",
          `You're up ${pct(pnlPct, 0)}, but it expires ${days === 0 ? "today" : "tomorrow"} out of the money. If the stock doesn't move ${signedPct(t.strike / spot - 1, 1)} it goes to zero, so lock the gain.`,
        )
      : say(
          "Sell",
          "sell",
          "bad",
          "Bad position, sell now",
          `It expires ${days === 0 ? "today" : "tomorrow"} out of the money and needs a ${signedPct(t.strike / spot - 1, 1)} move. Sell to keep the ${usd(value, 0)} that is left.`,
        );
  if (pnlPct >= 0.5 && (against || days <= 3))
    return say(
      "Take profit",
      "sell",
      "good",
      "Good position, sell now",
      against
        ? `Up ${pct(pnlPct, 0)} and momentum just turned against it. This is the moment to bank it.`
        : `Up ${pct(pnlPct, 0)} with ${days} day${days === 1 ? "" : "s"} left. Decay speeds up from here, so the gain is at its most fragile.`,
    );
  if (pnlPct <= -0.5 && (days <= 5 || odds < 0.15))
    return say(
      "Sell",
      "sell",
      "bad",
      "Bad position, cut it",
      `Down ${pct(-pnlPct, 0)} with only ${pct(odds, 0)} odds of getting back to break-even. Cutting keeps ${usd(value, 0)} for a better setup.`,
    );
  if (daysToEarnings !== undefined && daysToEarnings >= 0 && daysToEarnings <= 1 && pnlPct >= 0.2)
    return say(
      "Trim",
      "trim",
      "good",
      "Good position, take some off before earnings",
      `Up ${pct(pnlPct, 0)} with earnings ${daysToEarnings === 0 ? "today" : "tomorrow"}. Sell part before implied vol collapses after the report.`,
    );
  if (decayShare >= 0.08 && !withIt)
    return up
      ? say(
          "Trim",
          "trim",
          "mixed",
          "In profit but bleeding, take some off",
          `Decay eats ${pct(decayShare, 0)} of it a day and momentum isn't paying for that. Bank part of the ${pct(pnlPct, 0)} gain.`,
        )
      : say(
          "Sell",
          "sell",
          "bad",
          "Bad position, cut it",
          `Down ${pct(-pnlPct, 0)} and decay eats ${pct(decayShare, 0)} of what's left every day with no momentum to offset it.`,
        );

  // nothing forces an exit: judge whether holding is worth it
  if (up)
    return say(
      "Hold",
      "keep",
      "good",
      "Good position, keep it",
      withIt
        ? `Up ${pct(pnlPct, 0)} with momentum on your side. Keep it; sell half at ${usd(base.target)} (double).`
        : `Up ${pct(pnlPct, 0)} and no exit signal. Keep it; sell half at ${usd(base.target)} (double), sell all below ${usd(t.entryPrice)}.`,
    );
  if (odds >= 0.3 || withIt)
    return say(
      "Hold",
      "keep",
      "mixed",
      "Losing, but worth keeping open",
      `Down ${pct(-pnlPct, 0)}, but there's a ${pct(odds, 0)} chance it finishes past break-even${withIt ? " and momentum is turning your way" : ""}. Keep it; cut it at ${usd(base.stop)} (half).`,
    );
  return say(
    "Wait",
    "keep",
    "bad",
    "Losing and weak, consider cutting",
    `Down ${pct(-pnlPct, 0)} with only ${pct(odds, 0)} odds of recovering${against ? " and momentum against you" : ""}. Cut it if it falls to ${usd(base.stop)}, or now if you need the capital.`,
  );
}
