import { popLong, probAbove } from "./bs";
import { pct, shortDate, signedPct, usd } from "./format";
import { exitRules, horizonOfDte, sellBy } from "./instruction";
import type { Analysis } from "./thesis";
import type { Catalyst, Enriched, Thesis, Trade, Verdict } from "./types";

/**
 * A direct call on an open long option, judged against the case it was opened on.
 *
 * Hard exits, checked first and shown at once:
 *   1. the profit target is reached              -> sell (sell half when the target is +100%)
 *   2. the stop is reached                       -> cut
 *   3. the stock crosses the thesis's invalidation price -> cut: the reason for the trade is gone
 *   4. the sell-by time has passed               -> sell
 * Judgement exits, which must hold for a minute and a half before the call changes:
 *   5. the full analysis has turned clearly against the position -> sell or cut
 *   6. strong reversal warnings while the position is up      -> take some off
 *   7. earnings before expiry tomorrow with a gain             -> take some off
 * Otherwise the position is kept, even through short-term dips, because nothing that
 * defined the trade has changed. Minute-to-minute momentum never causes a sell.
 */
export function verdictOf(
  t: Trade,
  c: Enriched,
  spot: number,
  ctx: { analysis?: Analysis; thesis?: Thesis; catalyst?: Catalyst },
): Verdict {
  const mark = c.mid;
  const pnlPct = t.entryPrice > 0 ? mark / t.entryPrice - 1 : 0;
  const up = pnlPct >= 0;
  const dte = c.dte;
  const days = Math.max(0, Math.round(dte));
  const T = dte / 365;
  const isCall = t.type === "call";
  const be = isCall ? t.strike + t.entryPrice : t.strike - t.entryPrice;
  const odds = c.iv > 0 ? popLong(t.type, spot, t.strike, t.entryPrice, T, c.iv) : 0;
  const doubleLevel = isCall ? t.strike + 2 * t.entryPrice : t.strike - 2 * t.entryPrice;
  const finishPast = c.iv > 0 && doubleLevel > 0 ? probAbove(spot, doubleLevel, T, c.iv) : 0;
  const doubleOdds = pnlPct >= 1 ? 1 : Math.min(1, 2 * (isCall ? finishPast : 1 - finishPast));
  const decay = Math.min(Math.abs(c.theta), mark);
  const decayPerDay = decay * 100 * t.qty;
  const value = mark * 100 * t.qty;
  const gain = (mark - t.entryPrice) * 100 * t.qty;

  const entryDay = new Date(t.entryAt).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const horizon = horizonOfDte((Date.parse(t.expiration + "T21:00:00Z") - t.entryAt) / 86_400_000);
  const rules = exitRules(horizon);
  const target = t.entryPrice * (1 + rules.target);
  const stop = t.entryPrice * (1 - rules.stop);
  const by = sellBy(horizon, entryDay, t.expiration);
  const sellLimit = Math.max(0.01, Math.floor((mark - Math.max(0, mark - c.bid) * 0.25) * 100) / 100);

  const a = ctx.analysis;
  const th = ctx.thesis;
  const dirSign = isCall ? 1 : -1;
  const scoreFor = a ? a.score * dirSign : 0; // positive = the evidence supports this position
  const broken = th ? (isCall ? spot < th.invalidation : spot > th.invalidation) : false;
  const reversal = a && a.reversal.against === (isCall ? "bullish" : "bearish") ? a.reversal : undefined;
  const earnings =
    ctx.catalyst?.kind === "earnings" && ctx.catalyst.date && ctx.catalyst.date <= t.expiration ? ctx.catalyst.date : undefined;
  const daysToEarnings = earnings ? Math.round((Date.parse(earnings + "T21:00:00Z") - Date.now()) / 86_400_000) : undefined;

  const reasons: string[] = [
    `${up ? "Up" : "Down"} ${pct(Math.abs(pnlPct), 0)} (${gain >= 0 ? "+" : "-"}${usd(Math.abs(gain), 0)}), ${days} day${days === 1 ? "" : "s"} to expiry`,
  ];
  if (a)
    reasons.push(
      `Full analysis ${a.score > 0 ? "+" : ""}${a.score}/100 for ${t.underlying}: ${scoreFor >= 15 ? "supports" : scoreFor <= -15 ? "against" : "neutral on"} this ${t.type}`,
    );
  if (th)
    reasons.push(
      `Thesis holds while ${t.underlying} stays ${isCall ? "above" : "below"} ${usd(th.invalidation)} (now ${usd(spot)}, ${signedPct(th.invalidation / spot - 1, 1)} away)`,
    );
  reasons.push(`${pct(odds, 0)} odds the stock is past your ${usd(be)} break-even at expiry`);
  reasons.push(`Time decay costs ${usd(decayPerDay, 0)} a day`);
  if (reversal?.signs.length) reasons.push(`Reversal warning: ${reversal.signs.join("; ")}`);
  if (earnings) reasons.push(`Earnings ${shortDate(earnings)} lands before expiry; implied vol usually drops right after`);

  const half = Math.max(1, Math.floor(t.qty / 2));
  const third = Math.max(1, Math.round(t.qty / 3));
  const orderFor = (move: Verdict["move"]) =>
    move === "sell" || (move !== "keep" && t.qty === 1)
      ? `Sell ${t.qty === 1 ? "it" : `all ${t.qty}`} now at a limit of ${usd(sellLimit)}.`
      : move === "sell-half"
        ? `Sell ${half} of ${t.qty} now at a limit of ${usd(sellLimit)}; keep the rest with the same exits.`
        : move === "trim"
          ? `Sell ${third} of ${t.qty} now at a limit of ${usd(sellLimit)}.`
          : `Hold ${t.qty === 1 ? "it" : `all ${t.qty}`}. Sell at ${usd(target)}, if ${t.underlying} ${isCall ? "falls below" : "rises above"} ${
              th ? usd(th.invalidation) : "its key level"
            }, or by ${by.text}; cut at ${usd(stop)}.`;

  const base = {
    reasons,
    odds,
    doubleOdds,
    decayPerDay,
    dte,
    target,
    stop,
    targetPct: rules.target,
    stopPct: rules.stop,
    sellBy: by.text,
    thesis: th ? { text: th.text, invalidation: th.invalidation, reason: th.invalidationReason, source: th.source } : undefined,
    analysis: a ? { score: a.score, atEntry: th?.scoreAtEntry ?? a.score, reversalSigns: a.reversal.signs } : undefined,
  };
  const say = (
    action: Verdict["action"],
    move: Verdict["move"],
    quality: Verdict["quality"],
    callText: string,
    headline: string,
    urgent = false,
  ): Verdict => ({
    action,
    move,
    quality,
    call: callText,
    doNow: orderFor(move),
    urgent,
    tone: quality === "bad" ? "down" : move === "keep" ? (quality === "good" ? "up" : "neutral") : quality === "good" ? "up" : "warn",
    headline,
    ...base,
  });

  // --- hard exits ---------------------------------------------------------------
  if (pnlPct >= rules.target)
    return rules.target >= 1
      ? say(
          "Take profit",
          "sell-half",
          "good",
          "Good position, sell half now",
          `It hit the +${pct(rules.target, 0)} target. Selling half returns your stake; the rest rides with the same exits.`,
          true,
        )
      : say("Take profit", "sell", "good", "Good position, sell now", `It hit the +${pct(rules.target, 0)} target (${usd(target)}). Take the ${usd(gain, 0)}.`, true);
  if (pnlPct <= -rules.stop)
    return say("Sell", "sell", "bad", "Bad position, cut it", `It hit the stop (${usd(stop)}). Cutting keeps ${usd(value, 0)} for the next trade.`, true);
  if (broken && th)
    return say(
      "Sell",
      "sell",
      up ? "good" : "bad",
      up ? "Sell now: the thesis is broken" : "Bad position, cut it: the thesis is broken",
      `${t.underlying} is ${isCall ? "below" : "above"} ${usd(th.invalidation)} (${th.invalidationReason}). The reason for this trade no longer holds${up ? ", so keep the gain" : ""}.`,
      true,
    );
  if (Date.now() > by.at)
    return up
      ? say("Sell", "sell", "good", "Good position, sell now", `The hold window ended ${by.text}. Take the ${pct(pnlPct, 0)} gain before decay takes it.`, true)
      : say("Sell", "sell", "bad", "Bad position, cut it", `The hold window ended ${by.text}. Holding longer only adds decay.`, true);

  // --- judgement exits ----------------------------------------------------------
  if (a && scoreFor <= -35)
    return up
      ? say(
          "Sell",
          "sell",
          "good",
          "Good position, sell now: the evidence has turned",
          `The full analysis is now ${a.score > 0 ? "+" : ""}${a.score}/100, clearly against this ${t.type}. Take the gain while it is there.`,
        )
      : say(
          "Sell",
          "sell",
          "bad",
          "Bad position, cut it",
          `The full analysis is now ${a.score > 0 ? "+" : ""}${a.score}/100, clearly against this ${t.type}. The case for holding is gone.`,
        );
  if (reversal && reversal.risk >= 0.5 && pnlPct >= 0.25)
    return say(
      "Trim",
      "trim",
      "good",
      "Good position, take some off",
      `Up ${pct(pnlPct, 0)} with reversal warnings building: ${reversal.signs[0]}. Lock part of the gain.`,
    );
  if (daysToEarnings !== undefined && daysToEarnings >= 0 && daysToEarnings <= 1 && pnlPct >= 0.2)
    return say(
      "Trim",
      "trim",
      "good",
      "Good position, take some off before earnings",
      `Up ${pct(pnlPct, 0)} with earnings ${daysToEarnings === 0 ? "today" : "tomorrow"}. Sell part before implied vol collapses.`,
    );

  // --- hold ---------------------------------------------------------------------
  const why = th ? `the thesis holds above ${usd(th.invalidation)}` : "no exit rule has triggered";
  const whyText = th && !isCall ? `the thesis holds below ${usd(th.invalidation)}` : why;
  if (up)
    return say("Hold", "keep", "good", "Good position, keep it", `Up ${pct(pnlPct, 0)} and ${whyText}. Let it work toward ${usd(target)} (+${pct(rules.target, 0)}).`);
  if (scoreFor >= 0 || !a)
    return say(
      "Hold",
      "keep",
      "mixed",
      "Losing, but worth keeping open",
      `Down ${pct(-pnlPct, 0)}, but ${whyText} and the evidence still supports it. Dips like this are part of the trade; the stop is ${usd(stop)}.`,
    );
  return say(
    "Wait",
    "keep",
    "bad",
    "Losing and weakening, cut if it slips further",
    `Down ${pct(-pnlPct, 0)} and the analysis has drifted against it (${a.score > 0 ? "+" : ""}${a.score}/100). Cut at ${usd(stop)}, or sooner if it worsens.`,
  );
}
