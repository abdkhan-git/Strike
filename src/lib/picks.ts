import { brokerView } from "./broker";
import { pct, signedPct, usd } from "./format";
import { buyInstruction } from "./instruction";
import { chartOf, signals } from "./market";
import { currentPlan } from "./plan";
import { readBriefings, writeBriefings } from "./store";
import { recordPicks } from "./track";
import type { Briefing, Signal, TradePick } from "./types";

/**
 * Morning picks: the five setups where the most independent evidence points the same
 * way. Nothing here is a sure thing; the score only ranks how much lines up, and the
 * track record (track.ts) measures how picks at each score actually do.
 *
 * Candidates are the day's one-sided option flow (signals with conviction 60+), excluding
 * same-day expiries. Each is scored on:
 *   - conviction of the flow itself                         (50%)
 *   - stock momentum in the last 15 minutes agrees          (15%)
 *   - stock is moving that way today                        (10%)
 *   - 20-day trend agrees                                   (10%)
 *   - break-even is within a normal move before expiry      (15%)
 * and must be liquid: a spread under 12% of the price and at least 200 contracts traded.
 */

const etDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const COUNT = 5;

async function score(s: Signal): Promise<Omit<TradePick, "rank" | "qty" | "cost"> | undefined> {
  const c = s.lead;
  if (!c || s.horizon === "eod") return undefined;
  const price = c.ask || c.mid;
  if (!(price >= 0.1) || c.spreadPct > 0.12 || c.volume < 200 || c.dte < 1) return undefined;

  const chart = await chartOf(s.symbol).catch(() => undefined);
  const bull = s.direction === "bullish";
  const o = chart?.outlook;
  const momentum = o ? (o.lean === (bull ? "up" : "down") ? 1 : o.lean === "flat" ? 0.4 : 0) : 0.4;
  const today = bull ? s.changePct > 0 : s.changePct < 0;
  const trend = chart?.trend ? (bull ? chart.trend.vsSma20 > 0 : chart.trend.vsSma20 < 0) : false;
  // stock move needed to break even, in standard deviations of a move to expiry
  const sd = c.iv * Math.sqrt(c.dte / 365);
  const needed = Math.abs(c.breakeven / s.price - 1);
  const reach = sd > 0 ? needed / sd : 9;
  const reachScore = Math.max(0, 1 - reach / 1.2);

  const total = Math.round(
    0.5 * s.conviction + 15 * momentum + 10 * Number(today) + 10 * Number(trend) + 15 * reachScore,
  );

  const reasons = [s.reasons[0]];
  if (s.reasons[1]?.includes("open interest")) reasons.push(s.reasons[1]);
  reasons.push(
    momentum === 1
      ? `Stock momentum agrees: ${signedPct(o!.ret15)} in the last 15 minutes`
      : momentum === 0
        ? "Short-term momentum is against it right now"
        : "No short-term momentum either way yet",
  );
  reasons.push(
    `${today ? "Moving that way today" : "Moving the other way today"} (${signedPct(s.changePct)}), ${trend ? "with" : "against"} the 20-day trend`,
  );
  reasons.push(
    `Needs ${signedPct(c.breakeven / s.price - 1, 1)} to break even, ${reach <= 0.6 ? "well within" : reach <= 1 ? "within" : "beyond"} a normal move before expiry`,
  );

  return {
    symbol: s.symbol,
    name: s.name,
    direction: s.direction,
    horizon: s.horizon,
    score: total,
    conviction: s.conviction,
    contract: c,
    spot: s.price,
    target: price,
    stop: price,
    reach,
    reasons,
  };
}

/** Ranks today's candidates and sizes the top five to the plan's risk budget. */
export async function buildBriefing(): Promise<Briefing> {
  const [list, plan, broker] = await Promise.all([signals(), currentPlan(), brokerView().catch(() => undefined)]);
  const best = new Map<string, Signal>();
  for (const s of list.signals)
    if (s.conviction >= 60 && s.horizon !== "eod" && (best.get(s.symbol)?.conviction ?? 0) < s.conviction) best.set(s.symbol, s);

  const scored = (await Promise.all([...best.values()].slice(0, 16).map(score))).filter((x) => x !== undefined);
  scored.sort((a, b) => b.score - a.score);

  // when the plan has paused trading, picks are still listed at the base size so you can see them
  const budget = plan.budget > 0 ? plan.budget : plan.equity * plan.settings.riskPerTrade;
  const picks: TradePick[] = [];
  for (const p of scored) {
    const ins = buyInstruction(p.contract, { budget, horizon: p.horizon });
    // one contract may cost up to twice the budget; beyond that it is too big for this account
    if (ins.overBudget) continue;
    picks.push({ ...p, rank: picks.length + 1, qty: ins.qty, cost: ins.cost, target: ins.targetPrice, stop: ins.stopPrice });
    if (picks.length === COUNT) break;
  }

  const cash = broker?.accounts.reduce((s, a) => s + (a.cash ?? 0), 0);
  const total = picks.reduce((s, p) => s + p.cost, 0);
  const notes: string[] = [];
  if (plan.halted) notes.push(`Today's loss (${usd(plan.todayPnl, 0)}) has passed the plan's daily limit. By your own rules these are for watching or for tomorrow, not for buying today.`);
  else if (plan.budget <= 0) notes.push("Every position slot is in use. Close one before opening a pick.");
  if (cash !== undefined && total > cash)
    notes.push(`Buying all ${picks.length} costs ${usd(total, 0)} but the account has ${usd(cash, 0)} in cash. Take the top ones you can afford.`);
  notes.push(
    `Each pick is sized to ${usd(budget, 0)}, the plan's risk per trade. Change it under Plan > Edit goal and limits.`,
  );
  if (picks.length < COUNT) notes.push(`Only ${picks.length} setup${picks.length === 1 ? "" : "s"} passed the filters right now.`);

  return { day: etDay(Date.now()), at: Date.now(), equity: plan.equity, budget, cash, picks, notes, paused: plan.budget <= 0 };
}

/** Today's briefing if one was made, else the most recent. */
export async function latestBriefing(): Promise<Briefing | undefined> {
  const all = await readBriefings();
  return all.at(-1);
}

/** Builds, saves and records today's briefing. Returns it with a phone-ready summary. */
export async function runBriefing(): Promise<{ briefing: Briefing; title: string; body: string }> {
  const briefing = await buildBriefing();
  const all = (await readBriefings()).filter((b) => b.day !== briefing.day);
  await writeBriefings([...all, briefing].slice(-60));
  await recordPicks(briefing.picks);

  const lines = briefing.picks.map(
    (p) => `${p.rank}. ${buyInstruction(p.contract, { budget: briefing.budget, horizon: p.horizon }).text} (score ${p.score})`,
  );
  return {
    briefing,
    title: `Strike picks: ${briefing.picks.map((p) => p.symbol).join(", ") || "none today"}`,
    body: lines.length
      ? `${briefing.paused ? "PLAN PAUSED TODAY: your loss limit or position slots say no new trades. Watch only.\n" : ""}${lines.join("\n")}\nRisk ${usd(briefing.budget, 0)} each. Odds the stock passes break-even: ${briefing.picks
          .map((p) => `${p.symbol} ${pct(p.contract.pop, 0)}`)
          .join(", ")}.`
      : "No setup passed the filters this morning.",
  };
}
