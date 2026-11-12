import { breakeven, bsGreeks, impliedVol, popLong } from "./bs";
import { compact, contractLabel, pct, shortDate, signedPct, usdCompact } from "./format";
import { whyContract } from "./reason";
import type { Catalyst, Enriched, Horizon, OptionContract, Quote, Signal, SymbolSummary } from "./types";

const clamp = (x: number) => Math.max(0, Math.min(1, x));

export function dteOf(exp: string, now = Date.now()) {
  // options stop trading 4pm ET on expiration day (~21:00 UTC)
  return Math.max((Date.parse(exp + "T21:00:00Z") - now) / 86_400_000, 0);
}

export function enrich(raw: OptionContract, S: number, now = Date.now()): Enriched {
  // Re-derive IV and greeks from the live bid/ask so they move with the market.
  // Vendor greeks (Tradier/ORATS) refresh about hourly; they stay as the fallback.
  let c = raw;
  const T = dteOf(raw.expiration, now) / 365;
  if (raw.bid > 0 && raw.ask > 0 && T > 0) {
    const iv = impliedVol(raw.type, S, raw.strike, T, (raw.bid + raw.ask) / 2);
    if (iv > 0) c = { ...raw, iv, ...bsGreeks(raw.type, S, raw.strike, T, iv) };
  }
  const mid = c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.last;
  const spreadPct = mid > 0 ? (c.ask - c.bid) / mid : 1;
  const volOi = c.volume / Math.max(c.openInterest, 1);
  const dte = dteOf(c.expiration, now);
  const cost = c.ask > 0 ? c.ask : mid;
  const pop = c.iv > 0 ? popLong(c.type, S, c.strike, cost, dte / 365, c.iv) : 0;

  // Flow score: how unusual and how tradable the contract is right now.
  const unusual = clamp(Math.log10(1 + volOi) / Math.log10(6)); // 5x OI saturates
  const size = clamp(Math.log10(1 + c.volume) / 4); // 10k contracts saturates
  const tight = clamp(1 - spreadPct / 0.15);
  const sweet = clamp(1 - Math.abs(Math.abs(c.delta) - 0.4) / 0.4);
  const score = Math.round(100 * (0.4 * unusual + 0.25 * size + 0.2 * tight + 0.15 * sweet));

  return {
    ...c,
    mid,
    spreadPct,
    volOi,
    pop,
    breakeven: breakeven(c.type, c.strike, cost),
    dte,
    score,
    premiumFlow: c.volume * mid * 100,
    lastPos: c.bid > 0 && c.ask > c.bid && c.last > 0 ? clamp((c.last - c.bid) / (c.ask - c.bid)) : 0.5,
  };
}

export function summarize(quote: Quote, exp: string, contracts: Enriched[], catalyst?: Catalyst): SymbolSummary {
  let callVol = 0,
    putVol = 0,
    callPrem = 0,
    putPrem = 0;
  for (const c of contracts) {
    if (c.type === "call") {
      callVol += c.volume;
      callPrem += c.premiumFlow;
    } else {
      putVol += c.volume;
      putPrem += c.premiumFlow;
    }
  }

  // ATM straddle -> market-implied move through this expiration
  let atmStrike = 0,
    best = Infinity;
  for (const c of contracts) {
    const d = Math.abs(c.strike - quote.price);
    if (d < best) {
      best = d;
      atmStrike = c.strike;
    }
  }
  const atm = contracts.filter((c) => c.strike === atmStrike);
  const straddle = atm.reduce((s, c) => s + c.mid, 0);
  const atmIv = atm.length ? atm.reduce((s, c) => s + c.iv, 0) / atm.length : 0;

  const flowBias = callPrem + putPrem > 0 ? (callPrem - putPrem) / (callPrem + putPrem) : 0;
  const top = [...contracts]
    .filter((c) => c.volume > 0 && c.mid >= 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => ({ ...c, why: whyContract(c, { spot: quote.price, flowBias, catalyst }) }));

  return {
    quote,
    catalyst,
    exp,
    callVol,
    putVol,
    pcRatio: callVol > 0 ? putVol / callVol : 0,
    flowBias,
    expectedMovePct: quote.price > 0 ? straddle / quote.price : 0,
    atmIv,
    score: top.length ? Math.round(top.reduce((s, c) => s + c.score, 0) / top.length) : 0,
    top,
  };
}

/**
 * How one-sided today's positioning is in one expiration. Volume cannot say who initiated
 * a trade, and put buying is often a hedge, so this measures where money is going, not where
 * the stock will go.
 */
export function signalOf(
  quote: Quote,
  horizon: Horizon,
  exp: string,
  contracts: Enriched[],
  catalyst?: Catalyst,
): Signal | null {
  let callPrem = 0,
    putPrem = 0;
  for (const c of contracts) {
    if (c.type === "call") callPrem += c.premiumFlow;
    else putPrem += c.premiumFlow;
  }
  const total = callPrem + putPrem;
  if (total < 100_000) return null; // too thin to read anything into

  const bias = (callPrem - putPrem) / total;
  const type = bias >= 0 ? "call" : "put";
  const side = contracts.filter((c) => c.type === type);
  const S = quote.price;
  const isOtm = (c: Enriched) => (type === "call" ? c.strike > S : c.strike < S);
  let vol = 0,
    oi = 0,
    prem = 0,
    otmPrem = 0;
  for (const c of side) {
    vol += c.volume;
    oi += c.openInterest;
    prem += c.premiumFlow;
    if (isOtm(c)) otmPrem += c.premiumFlow;
  }
  const volOi = vol / Math.max(oi, 1);
  const otmShare = prem > 0 ? otmPrem / prem : 0;

  const lean = clamp((Math.abs(bias) - 0.1) / 0.6); // 85% of premium on one side saturates
  const unusual = clamp(Math.log10(1 + volOi) / Math.log10(4)); // 3x open interest saturates
  const size = clamp(Math.log10(Math.max(prem, 1) / 250_000) / Math.log10(200)); // $250K .. $50M
  const conviction = Math.round(100 * (0.45 * lean + 0.25 * unusual + 0.15 * size + 0.15 * otmShare));

  const live = side.filter((c) => c.volume > 0 && c.mid >= 0.05);
  const lead = (live.some(isOtm) ? live.filter(isOtm) : live).sort((a, b) => b.premiumFlow - a.premiumFlow)[0];
  const share = Math.max(callPrem, putPrem) / total;

  const reasons = [`${pct(share, 0)} of ${usdCompact(total)} premium traded today is in ${type}s`];
  if (volOi >= 0.5)
    reasons.push(
      `${type === "call" ? "Call" : "Put"} volume is ${volOi.toFixed(1)}× open interest${volOi >= 1 ? ", so positions are being opened" : ""}`,
    );
  if (lead)
    reasons.push(
      `Heaviest strike ${contractLabel(lead)}: ${compact(lead.volume)} traded, needs ${signedPct(lead.breakeven / S - 1, 1)} to break even`,
    );
  if (catalyst?.kind === "earnings" && catalyst.date && catalyst.date <= exp)
    reasons.push(`Earnings ${shortDate(catalyst.date)} falls inside this window`);

  return {
    symbol: quote.symbol,
    name: quote.name,
    price: quote.price,
    changePct: quote.changePct,
    horizon,
    exp,
    dte: contracts[0]?.dte ?? 0,
    direction: type === "call" ? "bullish" : "bearish",
    conviction,
    share,
    premium: total,
    volOi,
    lead,
    reasons,
    catalyst,
  };
}
