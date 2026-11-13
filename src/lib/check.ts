import { brokerView } from "./broker";
import { bsPrice } from "./bs";
import { marketContext } from "./context";
import type { CheckItem, Idea, IdeaCheck, MarketContext } from "./desk";
import { pct, signedPct, usd } from "./format";
import { buyInstruction, horizonOfDte } from "./instruction";
import { chartOf, symbolView } from "./market";
import { currentPlan } from "./plan";
import { session } from "./session";
import { analyze } from "./thesis";
import type { PlanView } from "./types";

/**
 * Trade check: a straight answer on a trade you are thinking about, from everything the
 * app knows right now. Fixed rules, no model, so it can be re-run every few seconds and
 * gives the same answer for the same market.
 *
 * Each check passes, warns or fails:
 *   direction   the full analysis is on the trade's side (±30 or better)
 *   momentum    the 15-minute read agrees (decisive for same-day expiries)
 *   flow        today's option money leans the same way
 *   reversal    no strong sign the move is ending
 *   reach       the break-even is inside a normal move for the time left
 *   decay       how much the position loses per hour/day if the stock stands still
 *   price       implied volatility against what the stock has really been doing
 *   liquidity   the bid/ask spread, and what a market order would give away
 *   timing      session, time left today, earnings and scheduled events before expiry
 *   size        cost against the plan's risk per trade, the account and cash
 *
 * Verdict: "skip" when any disqualifying check fails or the score is under 45. "go" when
 * nothing fails, the score is 70 or more, and the direction check itself passes (plus the
 * momentum check for a same-day contract). Otherwise "wait".
 */

type Status = CheckItem["status"];
const VALUE: Record<Status, number> = { pass: 1, warn: 0.5, fail: 0 };

/** The stock price at which the option is worth `target` with `T` years left. */
function spotFor(type: "call" | "put", target: number, strike: number, T: number, iv: number, S: number) {
  let lo = S * 0.5;
  let hi = S * 1.5;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const v = bsPrice(type, mid, strike, T, iv);
    // a call gains as the stock rises, a put as it falls
    if ((type === "call") === v < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export async function checkIdea(idea: Idea, shared?: { plan?: PlanView; ctx?: MarketContext; cash?: number }): Promise<IdeaCheck> {
  const asOf = Date.now();
  const unknown = (headline: string, action: string): IdeaCheck => ({ idea, verdict: "unknown", score: 0, headline, action, items: [], asOf });

  const view = await symbolView(idea.symbol, idea.expiration).catch(() => undefined);
  if (!view) return unknown(`No options data for ${idea.symbol}`, "Check the ticker, or remove this idea.");
  if (view.summary.exp !== idea.expiration) return unknown("This expiration has passed", "Remove it, or add the idea again with a live expiration.");
  const c = view.contracts.find((x) => x.type === idea.type && Math.abs(x.strike - idea.strike) < 1e-6);
  if (!c) return unknown(`No ${idea.type} at ${idea.strike} for this expiration`, "Pick a listed strike.");

  const [a, chart, plan, ctx, broker] = await Promise.all([
    analyze(idea.symbol).catch(() => undefined),
    chartOf(idea.symbol).catch(() => undefined),
    shared?.plan ?? currentPlan().catch(() => undefined),
    shared?.ctx ?? marketContext().catch(() => undefined),
    shared?.cash !== undefined ? undefined : brokerView().catch(() => undefined),
  ]);
  const cash = shared?.cash ?? broker?.accounts.reduce((s, x) => s + (x.cash ?? 0), 0);

  const S = view.summary.quote.price;
  const call = idea.type === "call";
  const side = call ? "bullish" : "bearish";
  const sameDay = c.dte < 1;
  const horizon = horizonOfDte(c.dte);
  const ins = buyInstruction(c, { budget: idea.dollars, horizon });
  const { state, time } = session(new Date());
  const mins = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const hoursLeft = Math.max(0, (16 * 60 - mins) / 60);

  const items: (CheckItem & { weight: number; hard?: boolean })[] = [];
  const add = (key: string, label: string, status: Status, detail: string, weight: number, hard = false) => items.push({ key, label, status, detail, weight, hard });

  // --- direction ---------------------------------------------------------------
  if (a) {
    const forIt = a.score * (call ? 1 : -1);
    add(
      "direction",
      "Direction",
      forIt >= 30 ? "pass" : forIt >= 0 ? "warn" : "fail",
      `Full analysis is ${a.score > 0 ? "+" : ""}${a.score}/100 for ${idea.symbol}: ${forIt >= 30 ? `clearly ${side}` : forIt >= 0 ? `only slightly ${side}` : `against a ${idea.type}`}.`,
      sameDay ? 15 : 25,
      forIt <= -15,
    );
  } else add("direction", "Direction", "warn", "Not enough price history for the full analysis.", 25);

  // --- short-term momentum -----------------------------------------------------
  const o = chart?.outlook;
  if (o) {
    const agrees = (call && o.lean === "up") || (!call && o.lean === "down");
    const against = (call && o.lean === "down") || (!call && o.lean === "up");
    add(
      "momentum",
      "Momentum, next 15 minutes",
      agrees ? "pass" : against ? (sameDay ? "fail" : "warn") : "warn",
      `${o.sentence} Price is ${signedPct(o.vsVwap)} from today's average and RSI is ${o.rsi.toFixed(0)}.`,
      sameDay ? 25 : 10,
      sameDay && against && o.strength >= 50,
    );
  } else add("momentum", "Momentum, next 15 minutes", "warn", "Not enough trading in this session yet for a short-term read.", sameDay ? 25 : 10);

  // --- option flow -------------------------------------------------------------
  if (a?.flow) add("flow", "Option flow", a.flow.direction === side ? "pass" : "fail", `Today's one-sided option money is ${a.flow.direction} (conviction ${a.flow.conviction}).`, 10);
  else add("flow", "Option flow", "warn", `No one-sided flow in ${idea.symbol} today: ${pct((view.summary.flowBias + 1) / 2, 0)} of premium is in calls.`, 10);

  // --- reversal ----------------------------------------------------------------
  if (a) {
    const hit = a.reversal.against === side;
    add(
      "reversal",
      "Reversal risk",
      !hit ? "pass" : a.reversal.risk >= 0.5 ? "fail" : "warn",
      hit ? `Signs this move is tiring: ${a.reversal.signs.join("; ")}.` : "No sign the move is running out.",
      10,
      hit && a.reversal.risk >= 0.5,
    );
  }

  // --- reach: break-even against a normal move ------------------------------------
  const T = c.dte / 365;
  const sigma = S * c.iv * Math.sqrt(T);
  const be = call ? c.strike + ins.limit : c.strike - ins.limit;
  const need = Math.max(0, call ? be - S : S - be);
  const ratio = sigma > 0 ? need / sigma : 9;
  add(
    "reach",
    "Reach",
    ratio <= 0.6 ? "pass" : ratio <= 1 ? "warn" : "fail",
    `Break-even is ${usd(be)}, ${signedPct(be / S - 1, 2)} from here. A normal move by expiry is ±${usd(sigma)} (±${pct(sigma / S, 2)}), so this needs ${ratio.toFixed(1)}× a normal move. Implied odds of finishing past it: ${pct(c.pop, 0)}.`,
    15,
  );

  // --- decay -------------------------------------------------------------------
  const step = sameDay ? Math.min(1, Math.max(hoursLeft, 0.25)) / (24 * 365) : 1 / 365;
  const lost = Math.max(0, c.mid - bsPrice(c.type, S, c.strike, Math.max(T - step, 0), c.iv));
  const decayPct = c.mid > 0 ? lost / c.mid : 0;
  const decay = { amount: lost * 100 * ins.qty, per: sameDay ? ("hour" as const) : ("day" as const), pct: decayPct };
  add(
    "decay",
    "Time decay",
    sameDay ? (decayPct > 0.2 ? "fail" : "warn") : decayPct > 0.06 ? "warn" : "pass",
    sameDay
      ? `If ${idea.symbol} stands still, this loses about ${pct(decayPct, 0)} (${usd(decay.amount, 0)}) in the next hour. Same-day options need the move now, not eventually.`
      : `Costs about ${pct(decayPct, 1)} (${usd(decay.amount, 0)}) a day while the stock stands still.`,
    5,
  );

  // --- price of the option -------------------------------------------------------
  const rv = chart?.trend?.rv20;
  if (!sameDay && rv && rv > 0 && c.iv > 0) {
    const r = c.iv / rv;
    add(
      "price",
      "Option price",
      r <= 1.4 ? "pass" : r <= 2 ? "warn" : "fail",
      `Implied volatility ${pct(c.iv, 0)} against ${pct(rv, 0)} realized over 20 days: you pay for ${r.toFixed(1)}× the movement the stock has been making.`,
      5,
    );
  }

  // --- liquidity -----------------------------------------------------------------
  const marketOrderCost = Math.max(0, c.ask - ins.limit) * 100 * ins.qty;
  const thin = c.volume + c.openInterest < 300;
  add(
    "liquidity",
    "Liquidity",
    c.spreadPct > 0.12 ? "fail" : c.spreadPct > 0.05 || thin ? "warn" : "pass",
    `Bid ${c.bid.toFixed(2)} / ask ${c.ask.toFixed(2)}: the spread is ${pct(c.spreadPct, 1)} of the price${thin ? ", and little has traded" : ""}. A market order pays the ask, about ${usd(marketOrderCost, 0)} more than a limit at ${usd(ins.limit)}.`,
    10,
    c.spreadPct > 0.12,
  );

  // --- timing ------------------------------------------------------------------
  const earnings = view.summary.catalyst?.kind === "earnings" && view.summary.catalyst.date && view.summary.catalyst.date <= idea.expiration ? view.summary.catalyst.date : undefined;
  const todayEvent = ctx?.events.find((e) => e.inDays === 0 && (e.kind === "fed" || e.kind === "jobs"));
  let timing: Status = "pass";
  const notes: string[] = [];
  let timingHard = false;
  if (state !== "Market open") {
    timing = "warn";
    notes.push(`The market is ${state === "Closed" ? "closed" : state.toLowerCase()}: this is a read on the last prices, re-check after the open.`);
  } else if (mins < 9 * 60 + 45) {
    timing = "warn";
    notes.push("First 15 minutes: spreads are wide and the opening move often reverses. Wait until 9:45.");
  }
  if (sameDay && state === "Market open") {
    if (hoursLeft < 1) {
      timing = "fail";
      timingHard = true;
      notes.push(`Only ${Math.round(hoursLeft * 60)} minutes of trading left: decay outruns almost any move from here.`);
    } else {
      if (timing === "pass") timing = "warn";
      notes.push(`Expires today with ${hoursLeft.toFixed(1)} hours left. Your trade history loses the most on same-day expiries.`);
    }
  }
  if (earnings) {
    if (timing === "pass") timing = "warn";
    notes.push(`Earnings on ${earnings} land before expiry: the option's price can drop sharply right after, even if the stock moves your way.`);
  }
  if (todayEvent && c.dte <= 8) {
    if (timing === "pass") timing = "warn";
    notes.push(`${todayEvent.label} is today: short-dated trades can be whipsawed around it.`);
  }
  add("timing", "Timing", timing, notes.join(" ") || "Regular session, nothing scheduled before expiry.", 5, timingHard);

  // --- size ----------------------------------------------------------------------
  let planSize: IdeaCheck["planSize"];
  if (plan) {
    const base = plan.budget > 0 ? plan.budget : plan.equity * plan.settings.riskPerTrade;
    const atPlan = buyInstruction(c, { budget: base, horizon });
    planSize = { budget: base, qty: atPlan.overBudget ? 0 : atPlan.qty, cost: atPlan.cost };
    const share = ins.cost / Math.max(plan.equity, 1);
    const overCash = cash !== undefined && cash > 0 && ins.cost > cash;
    const status: Status = plan.halted || overCash || ins.cost > base * 2 ? "fail" : ins.cost > base * 1.05 ? "warn" : "pass";
    const stopLoss = ins.maxLoss;
    add(
      "size",
      "Size",
      status,
      plan.halted
        ? "Your plan has paused new trades today: the daily loss limit was reached."
        : `${usd(ins.cost, 0)} is ${pct(share, 0)} of your ${usd(plan.equity, 0)} account; your plan puts ${usd(base, 0)} on one trade${
            planSize.qty ? ` (${planSize.qty} contract${planSize.qty === 1 ? "" : "s"})` : " (not enough for one contract)"
          }. The stop alone would cost ${usd(stopLoss, 0)}${overCash ? `, and it is more than your ${usd(cash!, 0)} cash` : ""}.`,
      5,
      true,
    );
  }

  // --- verdict -----------------------------------------------------------------
  const total = items.reduce((s, i) => s + i.weight, 0);
  const score = Math.round((100 * items.reduce((s, i) => s + i.weight * VALUE[i.status], 0)) / Math.max(total, 1));
  const blockers = items.filter((i) => i.status === "fail" && i.hard);
  const fails = items.filter((i) => i.status === "fail");
  const open = state === "Market open";
  // a go needs the direction itself to pass, and for a same-day contract the short-term momentum too:
  // a pile of secondary checks cannot stand in for the trade having a reason
  const status = (key: string) => items.find((i) => i.key === key)?.status;
  const core = status("direction") === "pass" && (!sameDay || status("momentum") === "pass");
  const sizeOnly = blockers.length > 0 && blockers.every((b) => b.key === "size") && !plan?.halted;

  let verdict: IdeaCheck["verdict"];
  let headline: string;
  let action: string;
  if (blockers.length && !sizeOnly) {
    verdict = "skip";
    headline = `Skip: ${blockers.map((b) => b.label.toLowerCase()).join(", ")} ${blockers.length === 1 ? "rules" : "rule"} it out`;
    action = blockers[0].detail;
  } else if (score < 45) {
    verdict = "skip";
    headline = "Skip: too little lines up";
    action = `${fails.length} of ${items.length} checks fail. ${fails[0]?.detail ?? ""}`.trim();
  } else if (sizeOnly) {
    verdict = score >= 70 && fails.length === 1 && core ? "wait" : "skip";
    headline = verdict === "wait" ? "The setup passes, the size does not" : "Skip: oversized, and the setup is not strong enough to act on";
    action =
      planSize && planSize.qty > 0
        ? `Cut it to ${planSize.qty} contract${planSize.qty === 1 ? "" : "s"} (${usd(planSize.cost, 0)}). At ${usd(ins.cost, 0)} one stop-out takes ${usd(ins.maxLoss, 0)} out of the account.`
        : "One contract costs more than your plan allows on a trade. Pick a cheaper strike or skip it.";
  } else if (score >= 70 && fails.length === 0 && core) {
    verdict = open ? "go" : "closed";
    headline = open ? "Go: the checks line up" : "Lines up, but the market is not open";
    action = open
      ? `Place a limit order, not a market order: ${ins.text}`
      : "Re-check a few minutes after the open; this read is on stale prices.";
  } else {
    verdict = open ? "wait" : "closed";
    const weak = items.filter((i) => i.status !== "pass").sort((x, y) => y.weight - x.weight)[0];
    headline = open ? `Wait: ${weak ? weak.label.toLowerCase() : "the evidence"} is not there yet` : "Not there yet, and the market is not open";
    action = weak ? weak.detail : "Nothing disqualifies it, but not enough agrees to act.";
  }

  if (!open && verdict === "wait") verdict = "closed";

  // the stock price that gets the option to its target about halfway through the hold
  const holdT = Math.max(T * 0.5, 0);
  const needPrice = c.iv > 0 ? spotFor(c.type, ins.targetPrice, c.strike, holdT, c.iv, S) : undefined;

  return {
    idea,
    verdict,
    score,
    headline,
    action,
    items: items.map(({ key, label, status, detail }) => ({ key, label, status, detail })),
    contract: c,
    spot: S,
    horizon,
    order: {
      qty: ins.qty,
      limit: ins.limit,
      cost: ins.cost,
      target: ins.targetPrice,
      targetGain: ins.targetGain,
      stop: ins.stopPrice,
      maxLoss: ins.maxLoss,
      sellBy: ins.sellBy.text,
      text: ins.text,
    },
    planSize,
    needs: needPrice ? { price: needPrice, movePct: needPrice / S - 1 } : undefined,
    marketOrderCost,
    decay,
    asOf,
  };
}

/** Every idea on the watchlist, judged with one shared read of the plan and the market. */
export async function checkAll(ideas: Idea[]): Promise<IdeaCheck[]> {
  if (!ideas.length) return [];
  const [plan, ctx, broker] = await Promise.all([currentPlan().catch(() => undefined), marketContext().catch(() => undefined), brokerView().catch(() => undefined)]);
  const cash = broker?.accounts.reduce((s, x) => s + (x.cash ?? 0), 0) ?? 0;
  return Promise.all(
    ideas.map((idea) =>
      checkIdea(idea, { plan, ctx, cash }).catch(
        (e): IdeaCheck => ({ idea, verdict: "unknown", score: 0, headline: "Could not check this right now", action: e instanceof Error ? e.message : "Try again shortly.", items: [], asOf: Date.now() }),
      ),
    ),
  );
}
