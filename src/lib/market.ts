import { dteOf, enrich, signalOf, summarize } from "./analytics";
import { cached } from "./cache";
import { simProvider } from "./providers/sim";
import { tradierProvider } from "./providers/tradier";
import { outlookOf, trendOf } from "./outlook";
import type { Catalyst, ChartResult, Enriched, Horizon, Provider, ScanResult, Signal, SignalsResult, SymbolView } from "./types";

let active: Provider | undefined;

export function provider(): Provider {
  if (active) return active;
  const token = process.env.TRADIER_TOKEN;
  active = token ? tradierProvider(token, process.env.TRADIER_ENV ?? "sandbox", process.env.FINNHUB_API_KEY) : simProvider;
  return active;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/**
 * First expiration at least a day out that, if there is a dated catalyst, covers it.
 * Same-day (0DTE) chains are skipped by default: their volume dwarfs everything else
 * and would put SPY/QQQ at the top of every scan. They remain selectable per symbol.
 */
function pickExp(exps: string[], catalyst?: Catalyst) {
  const alive = exps.filter((e) => dteOf(e) >= 1);
  return alive.find((e) => !catalyst?.date || e >= catalyst.date) ?? alive[0] ?? exps[0];
}

/**
 * One chain, shared by the scan, signals, symbol view and position marks, so the same
 * expiration is never fetched twice inside `maxAge`.
 */
const chainOf = (p: Provider, symbol: string, exp: string, maxAge: number) =>
  cached(`chain|${symbol}|${exp}`, maxAge, () => p.chain(symbol, exp));

/** Scan and signals serve the last result while a refresh runs, so polling never waits on the feed. */
const scanTtl = (p: Provider) => (p.info.simulated ? 2_000 : 30_000);
const signalTtl = (p: Provider) => (p.info.simulated ? 3_000 : 180_000);

export function scan(): Promise<ScanResult> {
  const p = provider();
  const ttl = scanTtl(p);
  return cached("scan", ttl, () => runScan(p, ttl), { stale: true });
}

async function runScan(p: Provider, ttl: number): Promise<ScanResult> {
  const universe = await p.universe();
  const quotes = await p.quotes(universe.map((u) => u.symbol));
  const rows = (
    await mapLimit(universe, 5, async (u) => {
      try {
        const quote = quotes[u.symbol];
        if (!quote) return null;
        const exp = pickExp(await p.expirations(u.symbol), u.catalyst);
        if (!exp) return null;
        const contracts = (await chainOf(p, u.symbol, exp, ttl)).map((c) => enrich(c, quote.price));
        if (!contracts.length) return null;
        return summarize(quote, exp, contracts, u.catalyst);
      } catch {
        return null;
      }
    })
  ).filter((r) => r !== null);

  rows.sort((a, b) => b.score - a.score);
  const top: Enriched[] = rows
    .flatMap((r) => r.top)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  return { provider: p.info, asOf: Date.now(), rows, top };
}

export async function symbolView(symbol: string, exp?: string): Promise<SymbolView> {
  const p = provider();
  const [quotes, expirations, universe] = await Promise.all([p.quotes([symbol]), p.expirations(symbol), p.universe()]);
  const quote = quotes[symbol];
  if (!quote || !expirations.length) throw new Error(`No options data for ${symbol}`);
  const catalyst = universe.find((u) => u.symbol === symbol)?.catalyst;
  const chosen = exp && expirations.includes(exp) ? exp : pickExp(expirations, catalyst);
  const contracts = (await chainOf(p, symbol, chosen, p.info.simulated ? 1_000 : 4_000)).map((c) =>
    enrich(c, quote.price),
  );
  return {
    provider: p.info,
    asOf: Date.now(),
    summary: summarize(quote, chosen, contracts, catalyst),
    expirations,
    contracts,
  };
}

/** Price bars, the near-term momentum read and the daily trend context for one symbol. */
export function chartOf(symbol: string): Promise<ChartResult> {
  const p = provider();
  const sim = p.info.simulated;
  return cached(`chart|${symbol}`, sim ? 2_000 : 15_000, async () => {
    const [quotes, bars, daily] = await Promise.all([
      p.quotes([symbol]),
      p.intraday(symbol),
      cached(`daily|${symbol}`, 30 * 60_000, () => p.daily(symbol)),
    ]);
    const quote = quotes[symbol];
    if (!quote) throw new Error(`No quote for ${symbol}`);
    return {
      symbol,
      asOf: Date.now(),
      prevClose: quote.prevClose,
      bars,
      daily,
      outlook: outlookOf(symbol, bars, quote.price),
      trend: trendOf(daily, quote.price),
    };
  });
}

/** One contract with live price, IV and greeks, for marking and judging logged positions. */
export async function contractOf(underlying: string, exp: string, occ: string, spot: number): Promise<Enriched | undefined> {
  try {
    const p = provider();
    const c = (await chainOf(p, underlying, exp, p.info.simulated ? 1_000 : 10_000)).find((x) => x.occ === occ);
    return c ? enrich(c, spot) : undefined;
  } catch {
    return undefined;
  }
}

/** One expiration per time window: today, this week, about a month, about two months. */
function pickHorizons(exps: string[]): { horizon: Horizon; exp: string }[] {
  const d = exps.map((exp) => ({ exp, dte: dteOf(exp) }));
  const closest = (target: number, lo: number, hi: number) =>
    d.filter((x) => x.dte > lo && x.dte <= hi).sort((a, b) => Math.abs(a.dte - target) - Math.abs(b.dte - target))[0];
  const picks: [Horizon, { exp: string } | undefined][] = [
    ["eod", d.find((x) => x.dte > 0 && x.dte < 1)],
    ["week", d.find((x) => x.dte >= 1 && x.dte <= 8)],
    ["month", closest(30, 14, 45)],
    ["quarter", closest(60, 45, 95)],
  ];
  return picks.flatMap(([horizon, x]) => (x ? [{ horizon, exp: x.exp }] : []));
}

export function signals(): Promise<SignalsResult> {
  const p = provider();
  const ttl = signalTtl(p);
  return cached("signals", ttl, () => runSignals(p, ttl), { stale: true });
}

/** Up to four chains per symbol, which is why live signals refresh less often than the scan. */
async function runSignals(p: Provider, ttl: number): Promise<SignalsResult> {
  const universe = await p.universe();
  const quotes = await p.quotes(universe.map((u) => u.symbol));
  const found = await mapLimit(universe, 4, async (u) => {
    const out: Signal[] = [];
    const quote = quotes[u.symbol];
    if (!quote) return out;
    try {
      for (const { horizon, exp } of pickHorizons(await p.expirations(u.symbol))) {
        const contracts = (await chainOf(p, u.symbol, exp, ttl)).map((c) => enrich(c, quote.price));
        const s = signalOf(quote, horizon, exp, contracts, u.catalyst);
        if (s) out.push(s);
      }
    } catch {
      // keep whatever horizons loaded for this symbol
    }
    return out;
  });

  return { provider: p.info, asOf: Date.now(), signals: found.flat().sort((a, b) => b.conviction - a.conviction) };
}
