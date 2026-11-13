import { cached } from "./cache";
import { marketContext } from "./context";
import type { Brief } from "./desk";
import { contractLabel, signedPct, signedUsd, usd } from "./format";
import { focusList, type FocusItem } from "./focus";
import { gapFor, type GapRead } from "./gap";
import { scan } from "./market";
import { paperView } from "./paper";
import { latestBriefing } from "./picks";
import { currentPlan } from "./plan";
import { tradeViews } from "./positions";
import { addTradingDays, etDay, isTradingDay, session } from "./session";
import { readWatch } from "./store";
import { styleOf } from "./styles";

/**
 * The brief: before the open, what the day looks like and what your rules allow; after
 * the close, what happened against the plan and what carries into tomorrow. Assembled
 * from the same data every other page uses (plan, positions, picks, paper lab, market
 * context), so nothing here can disagree with them. No model writes any of it.
 */

const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

export function buildBrief(): Promise<Brief> {
  return cached("brief3", 10_000, build, { stale: true });
}

async function build(): Promise<Brief> {
  const now = new Date();
  const day = etDay(now.getTime());
  const { state, time } = session(now);
  const mins = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const trading = isTradingDay(day);
  const phase: Brief["phase"] = !trading ? "closed" : state === "Market open" ? "open" : mins < 570 ? "pre" : "post";
  const nextDay = phase === "pre" || phase === "open" ? day : addTradingDays(day, 1);

  const trades = await tradeViews();
  const [plan, context, rows, briefing, paper] = await Promise.all([
    currentPlan(trades),
    marketContext(),
    scan()
      .then((s) => s.rows)
      .catch(() => []),
    latestBriefing().catch(() => undefined),
    paperView().catch(() => undefined),
  ]);

  const open = trades.filter((t) => t.status === "open");
  const positions: Brief["positions"] = open.map((t) => ({
    id: t.id,
    label: `${t.underlying} ${contractLabel(t)}`,
    type: t.type,
    qty: t.qty,
    pnl: t.pnl,
    pnlPct: t.pnlPct,
    call: t.verdict?.call,
    tone: t.verdict?.tone,
    doNow: t.verdict?.doNow,
    sellBy: t.verdict?.sellBy,
    needsAction: !!t.verdict && (t.verdict.move !== "keep" || t.verdict.quality === "bad"),
  }));
  const needAction = positions.filter((p) => p.needsAction);

  const heldOcc = new Set(open.map((t) => t.occ));
  const picks: Brief["picks"] = (briefing?.picks ?? []).map((p) => {
    const sim = paper?.trades.find((x) => x.occ === p.contract.occ && x.day === briefing!.day && (x.source ?? "pick") === "pick");
    return {
      symbol: p.symbol,
      label: `${p.symbol} ${contractLabel(p.contract)}`,
      type: p.contract.type,
      day: briefing!.day,
      entry: sim?.entry ?? (p.contract.ask || p.contract.mid),
      pnl: sim?.pnl,
      pnlPct: sim?.pnlPct,
      status: !sim ? "not tracked" : sim.status === "open" ? "open on paper" : { target: "hit its target", stop: "stopped out", time: "timed out", thesis: "thesis broke", expiry: "expired" }[sim.exitReason ?? "time"],
      held: heldOcc.has(p.contract.occ),
    };
  });
  const picksToday = picks.filter((p) => p.day === day);

  // gaps: the indices first, then what you hold, what was picked and what you are watching
  let gaps: GapRead[] = [];
  if (phase !== "closed") {
    const watch = await readWatch().catch(() => []);
    const names = [...new Set(["SPY", "QQQ", "IWM", ...open.map((t) => t.underlying), ...picks.map((p) => p.symbol), ...watch.map((w) => w.symbol)])].slice(0, 12);
    gaps = (await Promise.all(names.map((s) => gapFor(s).catch(() => undefined)))).filter((g): g is GapRead => !!g && g.phase !== "none");
  }
  const gapWord = (g: GapRead) =>
    `${g.symbol} ${signedPct(g.gapPct)} (${Math.abs(g.gapAtr).toFixed(1)}× a normal day${g.phase === "open" && g.state !== "none" ? `, ${g.state}` : ""})`;
  const meaningful = gaps.filter((g) => Math.abs(g.gapAtr) >= 0.3).sort((a, b) => Math.abs(b.gapAtr) - Math.abs(a.gapAtr));
  const spyGap = gaps.find((g) => g.symbol === "SPY");
  const focus: FocusItem[] = phase === "pre" || phase === "open" ? await focusList().catch(() => []) : [];
  const leaning = focus.filter((f) => f.lean !== "two-way");
  // what you hold, and whether the move behind it is still there
  const heldLines = focus.filter((f) => f.held).map((f) => `You hold ${f.symbol} (${f.held!.label}): ${f.live.status.toLowerCase()}. ${f.live.note} ${f.held!.verdict}`);
  const focusLine = focus.length
    ? `Ones to watch: ${focus
        .filter((f) => !f.held)
        .slice(0, 4)
        .map((f) => {
          if (f.lean === "two-way") return `${f.symbol} (no agreed direction, not a trade)`;
          const missing = f.gate.filter((c) => c.kind === "required" && !c.ok).map((c) => c.label.toLowerCase());
          return f.ready
            ? `${f.symbol} ${f.lean}: ${f.grade} setup, ${f.grade === "A" ? "full" : "half"} size, put it through Watch`
            : `${f.symbol} leans ${f.lean}, not a trade (${missing.length ? `missing: ${missing.join(", ")}` : "too little agrees"})`;
        })
        .join("; ")}.${leaning.length ? " A lean is not a buy: the required conditions have to hold, and the grade sets the size." : ""}`
    : undefined;

  const today = plan.days.find((d) => d.day === day);
  const sorted = [...rows].sort((a, b) => b.quote.changePct - a.quote.changePct);
  const movers = [...sorted.slice(0, 4), ...sorted.slice(-4)].map((r) => ({ symbol: r.quote.symbol, price: r.quote.price, changePct: r.quote.changePct }));
  const size = plan.budget > 0 ? plan.budget : 0;
  const style = styleOf(plan.settings.style);
  const soon = context.events.filter((e) => e.kind !== "earnings" && e.inDays <= 1);
  const earningsSoon = context.events.filter((e) => e.kind === "earnings" && e.inDays <= 1).map((e) => e.label.replace(" earnings", ""));

  // --- the few sentences that matter ---------------------------------------------
  const lines: string[] = [];
  // the backdrop sentence already says when the index has no trend
  const cautions = context.cautions.filter((c) => !c.startsWith("The index has no clear trend"));
  const spy = context.spy;
  const backdrop = `${context.regime.label === "Mixed" ? "The index has no clear trend" : `The index is in ${context.regime.label === "Uptrend" ? "an uptrend" : "a downtrend"}`} (SPY analysis ${context.regime.score > 0 ? "+" : ""}${context.regime.score}) and volatility is ${context.vol.label.toLowerCase()}.`;

  if (phase === "pre" || phase === "closed") {
    lines.push(
      spyGap && spyGap.pre
        ? `SPY is ${signedPct(spyGap.gapPct)} pre-market at ${usd(spyGap.pre.last)} (${Math.abs(spyGap.gapAtr).toFixed(1)}× a normal day). ${backdrop}`
        : spy
          ? `SPY is ${signedPct(spy.changePct)} at ${usd(spy.price)} against the last close. ${backdrop}`
          : backdrop,
    );
    if (meaningful.length)
      lines.push(
        `Gapping: ${meaningful
          .slice(0, 5)
          .map(gapWord)
          .join("; ")}. A pre-market gap is a lean, not a signal: wait for what the stock does with it after 9:30.`,
      );
    for (const l of heldLines) lines.push(l);
    if (focusLine) lines.push(focusLine);
    const fills = meaningful.filter((g) => g.history && g.history.n >= 5 && g.history.filled / g.history.n >= 0.6);
    if (fills.length)
      lines.push(`These usually fill gaps like today's: ${fills.map((g) => `${g.symbol} (${g.history!.filled} of ${g.history!.n} times)`).join(", ")}. Chasing the gap at the open is the trap.`);
    lines.push(
      plan.halted
        ? "Your plan is paused: no new trades until the loss limit resets."
        : size > 0
          ? `Today's size is ${usd(size, 0)} a trade (${style.label} style)${plan.lastDayPnl !== undefined && plan.lastDayPnl < 0 ? ", halved after the last losing day" : ""}. The goal's pace asks for ${signedUsd(plan.needToday, 0)}; that number never raises the size.`
          : "Every position slot is in use: close one before opening another.",
    );
    if (positions.length)
      lines.push(
        needAction.length
          ? `${needAction.length} of ${positions.length} open position${positions.length === 1 ? "" : "s"} need${needAction.length === 1 ? "s" : ""} action at the open: ${needAction.map((p) => `${p.label} (${p.call})`).join("; ")}.`
          : `${positions.length} open position${positions.length === 1 ? "" : "s"}, none needing action. Sell-by times are listed below.`,
      );
    for (const c of cautions) lines.push(c);
    if (earningsSoon.length) lines.push(`Earnings in the next two sessions: ${earningsSoon.join(", ")}. Options on these lose value right after the report, whichever way the stock goes.`);
    lines.push(phase === "closed" ? `The market is closed. Next session: ${dayName(nextDay)}. Picks are built at 9:45 ET.` : "Picks are built at 9:45 ET, once option flow has formed. Nothing is worth buying in the first 15 minutes.");
  } else if (phase === "open") {
    lines.push(spy ? `SPY is ${signedPct(spy.changePct)} at ${usd(spy.price)}. ${backdrop}` : backdrop);
    for (const l of heldLines) lines.push(l);
    if (focusLine) lines.push(focusLine);
    const failed = meaningful.filter((g) => g.state === "filled");
    const holding = meaningful.filter((g) => g.state === "holding" || g.state === "extending");
    if (failed.length || holding.length)
      lines.push(
        [holding.length ? `Gaps holding: ${holding.map(gapWord).join("; ")}.` : "", failed.length ? `Gaps that failed (back through yesterday's close): ${failed.map((g) => g.symbol).join(", ")}.` : ""]
          .filter(Boolean)
          .join(" "),
      );
    lines.push(`Realized today: ${signedUsd(plan.todayPnl, 0)}${plan.todayOpenPnl ? `, with ${signedUsd(plan.todayOpenPnl, 0)} open on today's trades` : ""}. ${plan.halted ? "The daily loss limit is hit: no new trades." : `Size for the next trade: ${usd(size, 0)}.`}`);
    if (needAction.length) lines.push(`Needs action now: ${needAction.map((p) => `${p.label}: ${p.doNow}`).join(" ")}`);
    if (picksToday.length) lines.push(`Today's picks: ${picksToday.map((p) => `${p.label} ${p.pnlPct !== undefined ? signedPct(p.pnlPct, 0) : ""} (${p.status})`).join("; ")}.`);
    for (const c of cautions) lines.push(c);
  } else {
    lines.push(
      today
        ? `You closed ${today.trades} trade${today.trades === 1 ? "" : "s"} today for ${signedUsd(today.pnl, 0)} (${today.wins} won). The goal's pace asked for ${signedUsd(plan.needToday, 0)}.`
        : `No trades closed today. The goal's pace asked for ${signedUsd(plan.needToday, 0)}; a day without a setup costs nothing.`,
    );
    if (plan.halted) lines.push("The daily loss limit was hit today. Tomorrow's size is halved.");
    if (picksToday.length)
      lines.push(`Today's picks on paper: ${picksToday.map((p) => `${p.label} ${p.pnl !== undefined ? `${signedUsd(p.pnl, 0)} (${signedPct(p.pnlPct ?? 0, 0)})` : ""}, ${p.status}`).join("; ")}.`);
    else lines.push("No picks passed the filters today.");
    if (positions.length)
      lines.push(
        `Carrying ${positions.length} position${positions.length === 1 ? "" : "s"} overnight (${signedUsd(plan.openPnl, 0)} open)${needAction.length ? `; ${needAction.length} should be dealt with at the open: ${needAction.map((p) => `${p.label} (${p.call})`).join("; ")}` : ""}.`,
      );
    if (spy) lines.push(`SPY closed ${signedPct(spy.changePct)} at ${usd(spy.price)}. ${backdrop}`);
    const ahead = context.events.filter((e) => e.kind !== "earnings" && e.inDays >= 1 && e.inDays <= 3);
    if (ahead.length || earningsSoon.length)
      lines.push(`Ahead: ${[...ahead.map((e) => `${e.label} (${e.date})`), earningsSoon.length ? `earnings from ${earningsSoon.join(", ")}` : ""].filter(Boolean).join("; ")}.`);
  }

  // --- what to do, and when --------------------------------------------------------
  const checklist: Brief["checklist"] = [];
  if (phase === "pre" || phase === "closed") {
    for (const p of needAction) checklist.push({ when: "9:30", text: `${p.label}: ${p.doNow ?? p.call}` });
    checklist.push({ when: "9:30–9:45", text: "Do not open anything. Spreads are widest and the opening move often reverses." });
    checklist.push({ when: "9:45", text: "Picks arrive on your phone. Open Plan and buy only what still reads “Still valid”, with a limit order at the stated price." });
    checklist.push({ when: "After a fill", text: "Set the target and stop exactly as written. Know the “Wrong if” price before you buy." });
    for (const p of positions.filter((x) => !x.needsAction && x.sellBy)) checklist.push({ when: "Sell-by", text: `${p.label}: out by ${p.sellBy}.` });
    if (soon.length) checklist.push({ when: "Calendar", text: soon.map((e) => `${e.inDays === 0 ? "Today" : "Tomorrow"}: ${e.label}`).join(". ") + "." });
  } else if (phase === "open") {
    for (const p of needAction) checklist.push({ when: "Now", text: `${p.label}: ${p.doNow ?? p.call}` });
    checklist.push({ when: "Before any buy", text: "Run it through Watch. Buy on Go, with a limit order; a Wait is not a Go." });
    checklist.push({ when: "By 3:30", text: "Close anything expiring today. Check each position's sell-by time." });
  } else {
    for (const p of needAction) checklist.push({ when: `${dayName(nextDay).split(",")[0]} 9:30`, text: `${p.label}: ${p.doNow ?? p.call}` });
    checklist.push({ when: "Tonight", text: "Nothing to place. Orders entered now fill at the open, at whatever the price is then." });
    checklist.push({ when: `${dayName(nextDay).split(",")[0]} 9:00`, text: "The pre-market brief arrives on your phone. Picks follow at 9:45." });
  }

  const title = phase === "pre" ? `Pre-market brief · ${dayName(day)}` : phase === "open" ? `Session · ${dayName(day)}` : phase === "post" ? `Round-up · ${dayName(day)}` : `Market closed · next session ${dayName(nextDay)}`;
  const push = {
    title: phase === "post" ? `Strike round-up: ${today ? signedUsd(today.pnl, 0) : "no trades"} today` : `Strike brief: ${context.regime.label.toLowerCase()} market, ${plan.halted ? "plan paused" : `${usd(size, 0)} a trade`}`,
    body: lines.slice(0, 5).join("\n"),
  };

  return {
    asOf: Date.now(),
    day,
    phase,
    title,
    lines,
    context,
    movers,
    gaps,
    focus,
    plan: { equity: plan.equity, budget: plan.budget, needToday: plan.needToday, todayPnl: plan.todayPnl, todayOpenPnl: plan.todayOpenPnl, halted: plan.halted, style: style.label, notes: plan.notes },
    positions,
    picks,
    result: today ? { pnl: today.pnl, trades: today.trades, wins: today.wins } : undefined,
    nextSession: dayName(nextDay),
    checklist,
    push,
  };
}
