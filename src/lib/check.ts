import { brokerView } from "./broker";
import { bsPrice, probAbove } from "./bs";
import { cached } from "./cache";
import { marketContext } from "./context";
import type { CheckItem, Idea, IdeaCheck, MarketContext } from "./desk";
import { pct, signedPct, usd } from "./format";
import { buyInstruction, horizonOfDte } from "./instruction";
import { chartOf, symbolView } from "./market";
import { currentPlan } from "./plan";
import { session } from "./session";
import { readTrades } from "./store";
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
 *   entry       how much of a normal day's move is already done: early, in play, or chasing
 *   reach       the break-even is inside a normal move for the time left
 *   decay       how much the position loses per hour/day if the stock stands still
 *   price       implied volatility against what the stock has really been doing
 *   liquidity   the bid/ask spread, and what a market order would give away
 *   timing      session, time left today, earnings and scheduled events before expiry
 *   size        cost against the plan's risk per trade, the account and cash
 *
 * Lottery lane: a contract with a delta under 0.25 is a low-odds, high-payoff bet. It is
 * allowed, on two conditions a desk would insist on: the cost is capped at 2% of the
 * account (most of these expire worthless, so the edge only exists across many small
 * ones), and the option must be cheap, with implied volatility no more than 1.2× what the
 * stock has really been doing.
 *
 * Payoff: every check reports how often the trade must work to break even at its target
 * and stop, next to the options market's own odds of the stock reaching the target level
 * in the hold. The market's odds are usually a little short of break-even: the edge has
 * to come from the other checks, and this line shows how much of one is needed.
 *
 * Verdict: "skip" when any disqualifying check fails or the score is under 45. "go" only
 * when nothing fails and the direction, entry-timing and reversal checks all pass outright
 * (plus momentum for a same-day contract): with a score of 80 or more it is an A setup at
 * full plan size, from 70 to 79 a B setup at half size. Anything less is "wait".
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

  // far out of the money: low odds, high payoff. Judged in its own lane, with its own size cap.
  const lottery = Math.abs(c.delta) < 0.25;
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

  // --- entry: has the move already happened? -------------------------------------
  let entry: IdeaCheck["entry"];
  const atr = a?.levels.atr;
  if (atr && atr > 0) {
    const q = view.summary.quote;
    const dir = call ? 1 : -1;
    const used = ((S - q.prevClose) * dir) / atr; // share of a normal day's range already travelled our way
    const atExtreme = o ? (call ? o.dayPos >= 0.9 : o.dayPos <= 0.1) : false;
    const stretched = o ? o.vsVwap * dir > 0.005 : false;
    const hot = o ? (call ? o.rsi >= 75 : o.rsi <= 25) : false;
    const movedTxt = `${idea.symbol} is ${signedPct(q.changePct)} today, ${Math.abs(used).toFixed(1)}× its normal daily range ${used >= 0 ? "in this trade's direction" : "against this trade"}`;
    if (used >= 1.5 || (used >= 1 && atExtreme && (stretched || hot))) {
      entry = "late";
      add("entry", "Entry timing", "fail", `Late: ${movedTxt}${atExtreme ? ", sitting at the day's extreme" : ""}${hot ? ` with RSI ${o!.rsi.toFixed(0)}` : ""}. Most of the move is done: buying here is chasing. Wait for a pullback toward ${o ? usd(o.vwap) : "the day's average"} or pass.`, 10);
    } else if (used >= 0.9) {
      entry = "late";
      add("entry", "Entry timing", "warn", `Getting late: ${movedTxt}. There is less left than there was; a pullback entry is better than buying strength here.`, 10);
    } else if (used <= -0.5) {
      entry = "against";
      add("entry", "Entry timing", "warn", `Fighting today's move: ${movedTxt}. This is a bet on a reversal, not on the move continuing.`, 10);
    } else {
      entry = used < 0.3 ? "early" : "in play";
      add("entry", "Entry timing", "pass", `${entry === "early" ? "Early" : "In play"}: ${movedTxt}${stretched ? ", though it sits above today's average price" : ""}. There is still room in a normal day.`, 10);
    }
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
      lottery ? (r <= 1.2 ? "pass" : "fail") : r <= 1.4 ? "pass" : r <= 2 ? "warn" : "fail",
      `Implied volatility ${pct(c.iv, 0)} against ${pct(rv, 0)} realized over 20 days: you pay for ${r.toFixed(1)}× the movement the stock has been making.${lottery ? " A lottery ticket is only worth buying when it is cheap: 1.2× or less." : ""}`,
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
    const planBase = plan.budget > 0 ? plan.budget : plan.equity * plan.settings.riskPerTrade;
    // a lottery ticket is sized to be lost: 2% of the account, never more than the plan's own size
    const base = lottery ? Math.min(planBase, plan.equity * 0.02) : planBase;
    const atPlan = buyInstruction(c, { budget: base, horizon });
    planSize = { budget: base, qty: atPlan.overBudget ? 0 : atPlan.qty, cost: atPlan.cost };
    const share = ins.cost / Math.max(plan.equity, 1);
    const overCash = cash !== undefined && cash > 0 && ins.cost > cash;
    const status: Status = plan.halted || overCash || ins.cost > base * (lottery ? 1.05 : 2) ? "fail" : ins.cost > base * 1.05 ? "warn" : "pass";
    const stopLoss = ins.maxLoss;
    add(
      "size",
      "Size",
      status,
      plan.halted
        ? "Your plan has paused new trades today: the daily loss limit was reached."
        : `${usd(ins.cost, 0)} is ${pct(share, 0)} of your ${usd(plan.equity, 0)} account; ${
            lottery ? `this is a lottery ticket (delta ${Math.abs(c.delta).toFixed(2)}), capped at 2% of the account: ${usd(base, 0)}` : `your plan puts ${usd(base, 0)} on one trade`
          }${
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
  // ...and the entry must not be late, nothing may warn of a reversal, and momentum must not be against it
  const core =
    status("direction") === "pass" &&
    status("entry") === "pass" &&
    status("reversal") === "pass" &&
    status("momentum") !== "fail" &&
    (!sameDay || status("momentum") === "pass");
  const sizeOnly = blockers.length > 0 && blockers.every((b) => b.key === "size") && !plan?.halted;

  let verdict: IdeaCheck["verdict"];
  let headline: string;
  let action: string;
  let grade: IdeaCheck["grade"];
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
    // A: everything lines up, full size. B: the must-haves pass with less behind them, half size.
    grade = score >= 80 ? "A" : "B";
    verdict = open ? "go" : "closed";
    const half = planSize ? Math.max(1, Math.floor(planSize.qty / 2)) : 1;
    headline = !open ? "Lines up, but the market is not open" : grade === "A" ? `Go: an A setup${lottery ? " (lottery size)" : ""}` : `Go at half size: a B setup${lottery ? " (lottery size)" : ""}`;
    action = !open
      ? "Re-check a few minutes after the open; this read is on stale prices."
      : grade === "A"
        ? `Place a limit order, not a market order: ${ins.text}`
        : `Enough lines up to trade, not enough for full size: buy ${half} contract${half === 1 ? "" : "s"} at a limit of ${usd(ins.limit)}, with the same target (${usd(ins.targetPrice)}) and stop (${usd(ins.stopPrice)}).`;
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

  // payoff: how often it must work, against the market's own odds of the target level
  const breakevenRate = ins.maxLoss / Math.max(ins.targetGain + ins.maxLoss, 1e-9);
  const implied =
    needPrice && c.iv > 0 && holdT > 0 ? Math.min(0.99, 2 * (call ? probAbove(S, needPrice, holdT, c.iv) : 1 - probAbove(S, needPrice, holdT, c.iv))) : undefined;

  return {
    idea,
    verdict,
    score,
    headline,
    action,
    grade: verdict === "go" ? grade : undefined,
    lane: lottery ? "lottery" : "standard",
    payoff: { breakeven: breakevenRate, implied, gain: ins.targetGain, loss: ins.maxLoss },
    items: items.map(({ key, label, status, detail }) => ({ key, label, status, detail })),
    entry,
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

/**
 * One contract judged at a dollar size, shared for a few seconds between the Watch page,
 * the calculator and the watcher so the option chain is not fetched once for each of them.
 */
export function checkContract(idea: Idea, shared?: Parameters<typeof checkIdea>[1]): Promise<IdeaCheck> {
  const key = `check|${idea.symbol}|${idea.type}|${idea.strike}|${idea.expiration}|${Math.round(idea.dollars)}`;
  return cached(key, 8_000, () => checkIdea(idea, shared)).then((c) => ({ ...c, idea }));
}

/**
 * Every idea on the watchlist, judged with one shared read of the plan and the market.
 * An idea whose contract is already an open position is marked as held, so the page can
 * point to Positions and the watcher stops alerting on it.
 */
export async function checkAll(ideas: Idea[]): Promise<IdeaCheck[]> {
  if (!ideas.length) return [];
  const [plan, ctx, broker, trades] = await Promise.all([
    currentPlan().catch(() => undefined),
    marketContext().catch(() => undefined),
    brokerView().catch(() => undefined),
    readTrades().catch(() => []),
  ]);
  const cash = broker?.accounts.reduce((s, x) => s + (x.cash ?? 0), 0) ?? 0;
  const open = trades.filter((t) => t.status === "open");
  return Promise.all(
    ideas.map(async (idea) => {
      const c = await checkContract(idea, { plan, ctx, cash }).catch(
        (e): IdeaCheck => ({ idea, verdict: "unknown", score: 0, headline: "Could not check this right now", action: e instanceof Error ? e.message : "Try again shortly.", items: [], asOf: Date.now() }),
      );
      const mine = open.filter((t) => t.underlying === idea.symbol && t.type === idea.type && t.strike === idea.strike && t.expiration === idea.expiration);
      if (!mine.length) return c;
      const qty = mine.reduce((s, t) => s + t.qty, 0);
      return { ...c, held: { qty, entryPrice: mine.reduce((s, t) => s + t.entryPrice * t.qty, 0) / qty } };
    }),
  );
}
