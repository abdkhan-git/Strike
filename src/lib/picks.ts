import { generateJson } from "./ai";
import { brokerView } from "./broker";
import { contractLabel, pct, signedPct, usd } from "./format";
import { buyInstruction, horizonOfDte } from "./instruction";
import { signals, symbolView } from "./market";
import { currentPlan } from "./plan";
import { readBriefings, readTheses, writeBriefings, writeTheses } from "./store";
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
 *  4. For each finalist, build a few liquid contracts: deltas 0.40-0.65 (likely to pay
 *     on a normal move), in the expiries the plan's style allows.
 *  5. An AI judge (free Gemini first, see ai.ts) reads all of it and chooses the trade(s)
 *     it would defend, writes the thesis and sets the stock price at which the thesis is
 *     wrong. Choosing nothing is allowed. With no model available, the strongest finalist
 *     and its best contract are taken by rule.
 *
 * The thesis and invalidation price are stored, and open positions are judged against
 * them, so the call does not change with every few minutes of noise.
 */

const etDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const DTE: Record<Horizon, [number, number]> = { eod: [0, 1], week: [2, 9], month: [10, 45], quarter: [46, 95] };

type Finalist = { a: Analysis; dir: "bullish" | "bearish"; strength: number; options: Enriched[]; earnings?: string };

async function finalists(horizons: Horizon[]): Promise<Finalist[]> {
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
    .slice(0, 4);

  const lo = Math.min(...horizons.map((h) => DTE[h][0]));
  const hi = Math.max(...horizons.map((h) => DTE[h][1]));
  const out: Finalist[] = [];
  for (const f of strong) {
    const view = await symbolView(f.a.symbol).catch(() => undefined);
    if (!view) continue;
    const exps = view.expirations.filter((e) => {
      const d = (Date.parse(e + "T21:00:00Z") - Date.now()) / 86_400_000;
      return d >= lo && d <= hi;
    });
    if (!exps.length) continue;
    const type = f.dir === "bullish" ? "call" : "put";
    const options: Enriched[] = [];
    // two expiries: the nearest allowed and one about a week further out
    const later = exps.find((e) => (Date.parse(e) - Date.parse(exps[0])) / 86_400_000 >= 5);
    for (const exp of later ? [exps[0], later] : [exps[0]]) {
      const chain = (await symbolView(f.a.symbol, exp).catch(() => undefined))?.contracts ?? [];
      const ok = chain
        .filter(
          (c) =>
            c.type === type &&
            Math.abs(c.delta) >= 0.4 &&
            Math.abs(c.delta) <= 0.65 &&
            c.spreadPct <= 0.1 &&
            c.ask >= 0.2 &&
            c.volume + c.openInterest >= 300,
        )
        .sort((a, b) => Math.abs(Math.abs(a.delta) - 0.52) - Math.abs(Math.abs(b.delta) - 0.52))
        .slice(0, 2);
      options.push(...ok);
    }
    if (options.length)
      out.push({ ...f, options, earnings: view.summary.catalyst?.kind === "earnings" ? view.summary.catalyst.date : undefined });
  }
  return out;
}

const JUDGE = `You are the head trader choosing today's option trade(s) for one person's small account. You will defend the choice for its whole holding period, so pick only what the evidence strongly supports.

You get, for each finalist: a multi-factor analysis (each factor -1 bearish .. +1 bullish, with notes), reversal warnings, key price levels, and a few liquid contracts with their exact order (size, limit, target, stop, sell-by) and odds.

Decide like a professional:
- Weigh every factor. Trend and options flow agreeing matters most; intraday noise matters least.
- Look for what would make the trade fail: reversal signs, earnings before expiry, a stock already stretched far from its average, the market (SPY) pulling the other way, a break-even that needs more than a normal move.
- Prefer the contract with the best odds of reaching its target before its sell-by time, not the cheapest one.
- Choose at most the number of trades asked for. Choosing none is correct when nothing is strong enough: say so in "passed".
- For each trade set "invalidation": the stock price that proves the thesis wrong (just beyond the key support for a bullish trade, or resistance for a bearish one, allowing for the ATR). It must be a level the stock is not already past.
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

/** Rule-based choice when Claude is unavailable: strongest finalist, contract closest to 0.52 delta. */
function byRule(fins: Finalist[], n: number): Chosen[] {
  return fins.slice(0, n).map((f) => {
    const inv = f.dir === "bullish" ? f.a.levels.support - 0.25 * f.a.levels.atr : f.a.levels.resistance + 0.25 * f.a.levels.atr;
    const agreeing = f.a.factors.filter((x) => Math.sign(x.value) === Math.sign(f.a.score) && Math.abs(x.value) >= 0.5);
    return {
      f,
      c: f.options[0],
      conviction: Math.min(95, Math.abs(f.a.score)),
      thesis: `Analysis ${f.a.score > 0 ? "+" : ""}${f.a.score}/100: ${agreeing.map((x) => x.label.toLowerCase()).join(", ")} all point ${
        f.dir === "bullish" ? "up" : "down"
      }.`,
      invalidation: Math.round(inv * 100) / 100,
      invalidationReason: f.dir === "bullish" ? "below the nearest support" : "above the nearest resistance",
      risks: f.a.reversal.signs,
    };
  });
}

/** Ranks today's candidates and returns the trade(s) worth making, sized to the plan. */
export async function buildBriefing(): Promise<Briefing> {
  const [plan, broker] = await Promise.all([currentPlan(), brokerView().catch(() => undefined)]);
  const style = styleOf(plan.settings.style);
  const cash = broker?.accounts.reduce((s, a) => s + (a.cash ?? 0), 0);
  // when the plan has paused trading, picks are still listed at base size so you can see them
  let budget = plan.budget > 0 ? plan.budget : plan.equity * plan.settings.riskPerTrade;
  if (cash !== undefined && cash > 0) budget = Math.min(budget, cash);

  const fins = await finalists(style.horizons);
  const notes: string[] = [];
  let decidedBy = "rules";
  let chosen: Chosen[] = [];
  let passed: string | undefined;

  if (!fins.length) {
    passed = "No symbol had a clearly one-sided analysis with the option flow agreeing and no reversal warning against it. No trade beats a bad trade.";
  } else {
    const prompt = JSON.stringify({
      tradesWanted: style.picks,
      account: { equity: Math.round(plan.equity), cash: cash && Math.round(cash), budgetPerTrade: Math.round(budget), style: style.label },
      userHistory: "Lost most money on same-day expiries and by holding losers past the stop.",
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
        // the invalidation must sit on the losing side of the current price
        if (f && c && (f.dir === "bullish" ? p.invalidation < f.a.price : p.invalidation > f.a.price)) chosen.push({ f, c, ...p });
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

  return { day: etDay(Date.now()), at: Date.now(), equity: plan.equity, budget, cash, picks, notes, paused: plan.budget <= 0, passed };
}

/** Today's briefing if one was made, else the most recent. */
export async function latestBriefing(): Promise<Briefing | undefined> {
  return (await readBriefings()).at(-1);
}

/** Saves each pick's thesis so the position, once bought, is judged against the same case. */
async function saveTheses(b: Briefing) {
  const rows = await readTheses();
  const keep = rows.filter((t) => !b.picks.some((p) => p.contract.occ === t.occ));
  const fresh: Thesis[] = b.picks
    .filter((p) => p.thesis && p.invalidation)
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
