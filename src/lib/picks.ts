import { generateJson } from "./ai";
import { brokerView } from "./broker";
import { marketContext } from "./context";
import { contractLabel, pct, signedPct, usd } from "./format";
import { buyInstruction, horizonOfDte } from "./instruction";
import { signals, symbolView } from "./market";
import { openPaper } from "./paper";
import { currentPlan } from "./plan";
import { etDay as etDayOf } from "./session";
import { readBriefings, readTheses, readTrades, writeBriefings, writeTheses } from "./store";
import { styleOf } from "./styles";
import { analyze, type Analysis } from "./thesis";
import { recordPicks } from "./track";
import type { Briefing, Enriched, Horizon, Thesis, TradePick } from "./types";

/**
 * Picks: few trades, each one defended by the full analysis.
 *
 *  1. Shortlist symbols with one-sided option flow (plus SPY and QQQ).
 *  2. Run the full multi-factor analysis on each (trend, momentum, RSI, MACD, candles,
 *     intraday structure, options flow, market and relative strength, reversal signs).
 *  3. Keep only names where the analysis is clearly one-sided, the option flow agrees,
 *     and no strong reversal warning stands against the move.
 *  4. For each finalist, build a few liquid contracts you can actually afford at the
 *     plan's size: deltas 0.40-0.65 (likely to pay on a normal move), or 0.30-0.40 when
 *     nothing closer fits the budget, in the expiries the plan's style allows. A name
 *     whose cheapest suitable contract costs more than the budget is dropped, not shrunk
 *     into a lottery ticket.
 *  5. An AI judge (free Gemini first, see ai.ts) reads all of it and chooses the trade(s)
 *     it would defend, writes the thesis and sets the stock price at which the thesis is
 *     wrong. Choosing nothing is allowed. With no model available, the strongest finalist
 *     and its best contract are taken by rule.
 *
 * The thesis and invalidation price are stored, and open positions are judged against
 * them, so the call does not change with every few minutes of noise.
 */

const etDay = (ms: number) => etDayOf(ms);
const DTE: Record<Horizon, [number, number]> = { eod: [0, 1], week: [2, 9], month: [10, 45], quarter: [46, 95] };

type Finalist = { a: Analysis; dir: "bullish" | "bearish"; strength: number; options: Enriched[]; earnings?: string };

const costOf = (c: Enriched) => (c.ask || c.mid) * 100;

async function finalists(horizons: Horizon[], maxCost: number): Promise<{ fins: Finalist[]; skipped: string[] }> {
  const skipped: string[] = [];
  const list = (await signals()).signals;
  const bySymbol = new Map<string, number>();
  for (const s of list)
    if (s.conviction >= 50 && horizons.includes(s.horizon)) bySymbol.set(s.symbol, Math.max(bySymbol.get(s.symbol) ?? 0, s.conviction));
  const symbols = [
    ...new Set([
      ...[...bySymbol.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s]) => s)
        .slice(0, 12),
      "SPY",
      "QQQ",
    ]),
  ];

  const analyses = (await Promise.all(symbols.map((s) => analyze(s).catch(() => undefined)))).filter((a) => a !== undefined);
  const strong = analyses
    .map((a) => {
      const dir = a.score >= 0 ? ("bullish" as const) : ("bearish" as const);
      const flowAgrees = !a.flow || a.flow.direction === dir;
      return { a, dir, strength: Math.abs(a.score) - 40 * a.reversal.risk, flowAgrees };
    })
    .filter((x) => Math.abs(x.a.score) >= 30 && x.flowAgrees && x.a.reversal.risk < 0.5)
    .sort((x, y) => y.strength - x.strength)
    .slice(0, 6);

  const lo = Math.min(...horizons.map((h) => DTE[h][0]));
  const hi = Math.max(...horizons.map((h) => DTE[h][1]));
  const out: Finalist[] = [];
  for (const f of strong) {
    if (out.length >= 4) break;
    const view = await symbolView(f.a.symbol).catch(() => undefined);
    if (!view) continue;
    const exps = view.expirations.filter((e) => {
      const d = (Date.parse(e + "T21:00:00Z") - Date.now()) / 86_400_000;
      return d >= lo && d <= hi;
    });
    if (!exps.length) continue;
    const type = f.dir === "bullish" ? "call" : "put";
    const options: Enriched[] = [];
    let cheapest = Infinity;
    // two expiries: the nearest allowed and one about a week further out
    const later = exps.find((e) => (Date.parse(e) - Date.parse(exps[0])) / 86_400_000 >= 5);
    for (const exp of later ? [exps[0], later] : [exps[0]]) {
      const chain = (await symbolView(f.a.symbol, exp).catch(() => undefined))?.contracts ?? [];
      const liquid = chain.filter((c) => c.type === type && c.spreadPct <= 0.1 && c.ask >= 0.2 && c.volume + c.openInterest >= 300);
      const inDelta = (lo: number, hi: number) => liquid.filter((c) => Math.abs(c.delta) >= lo && Math.abs(c.delta) <= hi);
      const core = inDelta(0.4, 0.65);
      for (const c of core) cheapest = Math.min(cheapest, costOf(c));
      // one contract has to fit the plan's size; if nothing near the money does, step one notch further out
      const fits = (xs: Enriched[]) => xs.filter((c) => costOf(c) <= maxCost);
      const pool = fits(core).length ? fits(core) : fits(inDelta(0.3, 0.4));
      options.push(...pool.sort((a, b) => Math.abs(Math.abs(a.delta) - 0.52) - Math.abs(Math.abs(b.delta) - 0.52)).slice(0, 2));
    }
    if (options.length)
      out.push({ ...f, options, earnings: view.summary.catalyst?.kind === "earnings" ? view.summary.catalyst.date : undefined });
    else if (Number.isFinite(cheapest))
      skipped.push(
        `${f.a.symbol} (${f.dir}, analysis ${f.a.score > 0 ? "+" : ""}${f.a.score}) was strong enough, but one suitable contract costs ${usd(cheapest, 0)}, more than the ${usd(maxCost, 0)} this plan puts on a trade.`,
      );
  }
  return { fins: out, skipped };
}

const JUDGE = `You are the head trader choosing today's option trade(s) for one person's small account. You will defend the choice for its whole holding period, so pick only what the evidence strongly supports.

You get, for each finalist: a multi-factor analysis (each factor -1 bearish .. +1 bullish, with notes), reversal warnings, key price levels, and a few liquid contracts with their exact order (size, limit, target, stop, sell-by) and odds.

Decide like a professional:
- Weigh every factor. Trend and options flow agreeing matters most; intraday noise matters least.
- Look for what would make the trade fail: reversal signs, earnings before expiry, a stock already stretched far from its average, the market (SPY) pulling the other way, a break-even that needs more than a normal move.
- Prefer the contract with the best odds of reaching its target before its sell-by time, not the cheapest one.
- Choose at most the number of trades asked for. Choosing none is correct when nothing is strong enough: say so in "passed".
- For each trade set "invalidation": the stock price that proves the thesis wrong (just beyond the key support for a bullish trade, or resistance for a bearish one, allowing for the ATR). It must be a level the stock is not already past.
- "market" is the backdrop: the index regime, how much movement is priced in, and what is scheduled. A trade against a clear regime needs stronger evidence than one with it. A scheduled event (Fed decision, jobs report, earnings) before the sell-by time is a risk to name, and a reason to prefer the later expiry or to pass. When implied volatility is far above realized, the option is expensive: the stock has to move more than it has been moving just to break even.
- "goal" in the account tells you what the user is working toward. It decides nothing about direction or quality: never choose a weaker setup, a shorter expiry or a further out-of-the-money strike because the account is behind its goal. Between two equally strong trades, prefer the one whose target gain covers more of "neededToday".
- "conviction": 0-100, how sure you are this trade reaches its target before its sell-by time (70+ only when nearly every factor agrees and nothing threatens it).
- "thesis": 2-3 plain sentences: why this direction, why now, what has to happen. "risks": the 1-3 things most likely to make it fail. "passed": one or two sentences on why the other finalists lost.
Use only the numbers given. Do not invent news or prices.`;

const SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          occ: { type: "string" },
          conviction: { type: "integer", minimum: 0, maximum: 100 },
          thesis: { type: "string" },
          invalidation: { type: "number" },
          invalidationReason: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
        },
        required: ["occ", "conviction", "thesis", "invalidation", "invalidationReason", "risks"],
      },
    },
    passed: { type: "string" },
  },
  required: ["picks", "passed"],
};

type Judged = {
  picks: { occ: string; conviction: number; thesis: string; invalidation: number; invalidationReason: string; risks: string[] }[];
  passed: string;
};

type Chosen = {
  f: Finalist;
  c: Enriched;
  conviction: number;
  thesis: string;
  invalidation: number;
  invalidationReason: string;
  risks: string[];
};

const factorLines = (a: Analysis) =>
  a.factors.map((f) => `${f.label}: ${f.value >= 0 ? "+" : ""}${f.value.toFixed(2)} (${f.note})`);

/** The stock price that proves a trade wrong by rule: a quarter of a day's range beyond support or resistance. */
const ruleInvalidation = (f: Finalist) =>
  Math.round((f.dir === "bullish" ? f.a.levels.support - 0.25 * f.a.levels.atr : f.a.levels.resistance + 0.25 * f.a.levels.atr) * 100) / 100;

/** Rule-based choice when no model is available: strongest finalist, contract closest to 0.52 delta. */
function byRule(fins: Finalist[], n: number): Chosen[] {
  return fins.slice(0, n).map((f) => {
    const inv = ruleInvalidation(f);
    const agreeing = f.a.factors.filter((x) => Math.sign(x.value) === Math.sign(f.a.score) && Math.abs(x.value) >= 0.5);
    return {
      f,
      c: f.options[0],
      conviction: Math.min(95, Math.abs(f.a.score)),
      thesis: `Analysis ${f.a.score > 0 ? "+" : ""}${f.a.score}/100: ${agreeing.map((x) => x.label.toLowerCase()).join(", ")} all point ${
        f.dir === "bullish" ? "up" : "down"
      }.`,
      invalidation: inv,
      invalidationReason: f.dir === "bullish" ? "below the nearest support" : "above the nearest resistance",
      risks: f.a.reversal.signs,
    };
  });
}

/** Ranks today's candidates and returns the trade(s) worth making, sized to the plan. */
export async function buildBriefing(): Promise<Briefing> {
  const [plan, broker, ctx] = await Promise.all([currentPlan(), brokerView().catch(() => undefined), marketContext().catch(() => undefined)]);
  const style = styleOf(plan.settings.style);
  const cash = broker?.accounts.reduce((s, a) => s + (a.cash ?? 0), 0);
  // when the plan has paused trading, picks are still listed at base size so you can see them
  let budget = plan.budget > 0 ? plan.budget : plan.equity * plan.settings.riskPerTrade;
  if (cash !== undefined && cash > 0) budget = Math.min(budget, cash);

  const { fins, skipped } = await finalists(style.horizons, budget);
  const notes: string[] = [...skipped];
  let decidedBy = "rules";
  let chosen: Chosen[] = [];
  let passed: string | undefined;

  if (!fins.length) {
    passed = skipped.length
      ? "Every name that passed the analysis needs more money for one contract than this plan allows per trade. No trade beats an oversized one."
      : "No symbol had a clearly one-sided analysis with the option flow agreeing and no reversal warning against it. No trade beats a bad trade.";
  } else {
    const prompt = JSON.stringify({
      tradesWanted: style.picks,
      account: {
        equity: Math.round(plan.equity),
        cash: cash && Math.round(cash),
        budgetPerTrade: Math.round(budget),
        style: style.label,
        goal: {
          target: plan.settings.goal,
          by: plan.settings.targetDate,
          tradingDaysLeft: plan.tradingDaysLeft,
          neededToday: Math.round(plan.needToday),
          neededPerDayPct: pct(plan.requiredDaily, 2),
        },
      },
      userHistory: "Lost most money on same-day expiries and by holding losers past the stop.",
      market: ctx && {
        regime: ctx.regime.label,
        spyAnalysisScore: ctx.regime.score,
        volatility: ctx.vol.label,
        spyImpliedVol: pct(ctx.vol.atmIv, 0),
        spyRealizedVol20d: ctx.vol.realized ? pct(ctx.vol.realized, 0) : undefined,
        scheduledEvents: ctx.events.filter((e) => e.inDays <= 5).map((e) => `${e.date}: ${e.label}`),
        cautions: ctx.cautions,
      },
      finalists: fins.map((f) => ({
        symbol: f.a.symbol,
        price: f.a.price,
        changeToday: signedPct(f.a.changePct),
        analysisScore: f.a.score,
        direction: f.dir,
        factors: factorLines(f.a),
        reversalWarnings: f.a.reversal.signs,
        levels: Object.fromEntries(Object.entries(f.a.levels).map(([k, v]) => [k, v === undefined ? v : Math.round(v * 100) / 100])),
        earningsDate: f.earnings,
        contracts: f.options.map((c) => ({
          occ: c.occ,
          contract: contractLabel(c),
          daysToExpiry: Math.round(c.dte * 10) / 10,
          delta: Math.round(c.delta * 100) / 100,
          iv: pct(c.iv, 0),
          breakeven: c.breakeven,
          oddsPastBreakevenAtExpiry: pct(c.pop, 0),
          order: buyInstruction(c, { budget, horizon: horizonOfDte(c.dte) }).text,
        })),
      })),
    });
    const out = await generateJson<Judged>(JUDGE, prompt, SCHEMA, "judge");
    const judged = out?.data;
    if (out && judged && Array.isArray(judged.picks)) {
      decidedBy = out.model;
      passed = judged.passed;
      for (const p of judged.picks.slice(0, style.picks)) {
        const f = fins.find((x) => x.options.some((c) => c.occ === p.occ));
        const c = f?.options.find((x) => x.occ === p.occ);
        if (!f || !c || chosen.some((x) => x.f.a.symbol === f.a.symbol)) continue;
        // The invalidation must sit on the losing side of the price, at a distance the stock can
        // respect: closer than 0.3 of a day's range it trips on noise, further than 3.5 it protects
        // nothing. Outside that band the level from support/resistance is used instead.
        const dist = (f.dir === "bullish" ? f.a.price - p.invalidation : p.invalidation - f.a.price) / Math.max(f.a.levels.atr, 0.01);
        const sane = Number.isFinite(p.invalidation) && dist >= 0.3 && dist <= 3.5;
        chosen.push(
          sane
            ? { f, c, ...p }
            : { f, c, ...p, invalidation: ruleInvalidation(f), invalidationReason: f.dir === "bullish" ? "below the nearest support" : "above the nearest resistance" },
        );
      }
    } else {
      notes.push("No AI model was available, so the strongest finalist was chosen by rule.");
      chosen = byRule(fins, style.picks);
    }
  }

  const picks: TradePick[] = chosen.map((x, i) => {
    const h = horizonOfDte(x.c.dte);
    const ins = buyInstruction(x.c, { budget, horizon: h });
    return {
      rank: i + 1,
      symbol: x.f.a.symbol,
      name: x.f.a.symbol,
      direction: x.f.dir,
      horizon: h,
      score: x.conviction,
      conviction: x.conviction,
      contract: x.c,
      spot: x.f.a.price,
      qty: ins.qty,
      cost: ins.cost,
      target: ins.targetPrice,
      stop: ins.stopPrice,
      reach: 0,
      reasons: factorLines(x.f.a),
      thesis: x.thesis,
      invalidation: x.invalidation,
      invalidationReason: x.invalidationReason,
      analysisScore: x.f.a.score,
      risks: x.risks,
      decidedBy,
    };
  });

  if (plan.halted) notes.push(`Today's loss (${usd(plan.todayPnl, 0)}) has passed the plan's daily limit. By your own rules this is for watching or for tomorrow.`);
  else if (plan.budget <= 0) notes.push("Every position slot is in use. Close one before opening this.");
  notes.push(`Sized to ${usd(budget, 0)} (${style.label} style${cash !== undefined ? `, capped at your ${usd(cash, 0)} cash` : ""}).`);

  return { day: etDay(Date.now()), at: Date.now(), equity: plan.equity, budget, cash, picks, notes, paused: plan.budget <= 0, passed, needToday: plan.needToday };
}

/** Today's briefing if one was made, else the most recent. */
export async function latestBriefing(): Promise<Briefing | undefined> {
  return (await readBriefings()).at(-1);
}

/** Saves each pick's thesis so the position, once bought, is judged against the same case. */
async function saveTheses(b: Briefing) {
  const [rows, trades] = await Promise.all([readTheses(), readTrades()]);
  // a position you already hold keeps the case it was bought on: a re-rank must not move its exit
  const held = new Set(trades.filter((t) => t.status === "open").map((t) => t.occ));
  const replace = (occ: string) => !held.has(occ) || !rows.some((t) => t.occ === occ);
  const keep = rows.filter((t) => !b.picks.some((p) => p.contract.occ === t.occ && replace(t.occ)));
  const fresh: Thesis[] = b.picks
    .filter((p) => p.thesis && p.invalidation && replace(p.contract.occ))
    .map((p) => ({
      occ: p.contract.occ,
      symbol: p.symbol,
      direction: p.direction,
      text: p.thesis!,
      invalidation: p.invalidation!,
      invalidationReason: p.invalidationReason ?? "",
      scoreAtEntry: p.analysisScore ?? 0,
      at: b.at,
      source: "pick",
    }));
  await writeTheses([...keep, ...fresh].slice(-300));
}

/** Builds, saves and records the briefing. Returns it with a phone-ready summary. */
export async function runBriefing(): Promise<{ briefing: Briefing; title: string; body: string }> {
  const briefing = await buildBriefing();
  const all = (await readBriefings()).filter((b) => b.day !== briefing.day);
  await writeBriefings([...all, briefing].slice(-60));
  await recordPicks(briefing.picks);
  await saveTheses(briefing);
  await openPaper(briefing).catch((e) => console.warn("[paper] could not open paper trades:", e instanceof Error ? e.message : e));

  const lines = briefing.picks.map(
    (p) =>
      `${buyInstruction(p.contract, { budget: briefing.budget, horizon: p.horizon }).text}\nWhy: ${p.thesis}\nWrong if ${p.symbol} ${
        p.direction === "bullish" ? "falls below" : "rises above"
      } ${usd(p.invalidation ?? 0)}.`,
  );
  return {
    briefing,
    title: briefing.picks.length
      ? `Strike: ${briefing.picks.map((p) => `${p.symbol} ${p.direction}`).join(", ")}`
      : "Strike: no trade today",
    body: lines.length
      ? `${briefing.paused ? "PLAN PAUSED TODAY: for watching or tomorrow.\n" : ""}${lines.join("\n\n")}`
      : (briefing.passed ?? "Nothing was strong enough to trade this morning."),
  };
}
