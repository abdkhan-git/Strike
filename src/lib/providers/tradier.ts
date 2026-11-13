import { etDay } from "../session";
import type { Bar, Catalyst, OptionContract, Provider, Quote } from "../types";

/**
 * Tradier market data. Production tokens on a brokerage account are real-time;
 * sandbox tokens are 15-minute delayed.
 */

const WATCHLIST = [
  "SPY", "QQQ", "NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN", "MSFT", "GOOGL",
  "PLTR", "COIN", "MSTR", "NFLX", "INTC", "SOFI", "HOOD", "SMCI", "AVGO", "BABA",
];
/** Upcoming-earnings names added to the scan, largest by revenue estimate first. */
const EARNINGS_SLOTS = 14;
const EARNINGS_DAYS = 10;
const HOUR = 3_600_000;
const MAX_PER_MINUTE = 105;

const arr = <T,>(x: T | T[] | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const num = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : 0);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type FinnhubEvent = { symbol: string; date: string; hour?: string; revenueEstimate?: number | null };

export function tradierProvider(token: string, env: string, finnhubKey?: string): Provider {
  const live = env === "live";
  const base = live ? "https://api.tradier.com/v1" : "https://sandbox.tradier.com/v1";

  // Tradier allows 120 market-data requests a minute. Requests past the cap wait for the
  // oldest one to leave the rolling window instead of failing with a 429.
  const sent: number[] = [];
  async function slot() {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] >= 60_000) sent.shift();
      if (sent.length < MAX_PER_MINUTE) {
        sent.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, sent[0] + 60_000 - now + 10));
    }
  }

  async function get(path: string, params: Record<string, string>) {
    await slot();
    const res = await fetch(`${base}${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Tradier ${path} ${res.status}`);
    return res.json();
  }

  // Earnings calendar changes slowly; refresh hourly (Finnhub free tier is 60 req/min).
  let calCache: { at: number; events: FinnhubEvent[] } | undefined;
  async function earnings(): Promise<FinnhubEvent[]> {
    if (!finnhubKey) return [];
    if (calCache && Date.now() - calCache.at < HOUR) return calCache.events;
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/calendar/earnings?from=${day(0)}&to=${day(EARNINGS_DAYS)}&token=${finnhubKey}`,
        { cache: "no-store" },
      );
      if (!res.ok) return calCache?.events ?? [];
      const events = arr<FinnhubEvent>((await res.json()).earningsCalendar).filter((e) => /^[A-Z]{1,5}$/.test(e.symbol));
      calCache = { at: Date.now(), events };
      return events;
    } catch {
      return calCache?.events ?? [];
    }
  }

  function catalystOf(e: FinnhubEvent): Catalyst {
    const when = e.hour === "bmo" ? "before open" : e.hour === "amc" ? "after close" : "";
    return { kind: "earnings", label: when ? `Earnings ${when}` : "Earnings", date: e.date };
  }

  // Listed expirations don't change intraday; cache them so a scan costs one call per symbol.
  const expCache = new Map<string, { at: number; dates: string[] }>();

  return {
    info: {
      name: live ? "Tradier" : "Tradier sandbox",
      simulated: false,
      realtime: live,
      note: live ? "Real-time market data." : "Market data delayed 15 minutes.",
    },
    async universe() {
      const events = await earnings();
      const bySymbol = new Map(events.map((e) => [e.symbol, e]));
      const extra = events
        .filter((e) => !WATCHLIST.includes(e.symbol) && (e.revenueEstimate ?? 0) > 0)
        .sort((a, b) => (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0))
        .slice(0, EARNINGS_SLOTS)
        .map((e) => e.symbol);
      return [...WATCHLIST, ...extra].map((symbol) => {
        const e = bySymbol.get(symbol);
        return { symbol, catalyst: e ? catalystOf(e) : undefined };
      });
    },
    async quotes(symbols) {
      const json = await get("/markets/quotes", { symbols: symbols.join(",") });
      const out: Record<string, Quote> = {};
      for (const q of arr<Record<string, unknown>>(json.quotes?.quote)) {
        if (q.type !== "stock" && q.type !== "etf") continue; // unmatched symbols come back without a type
        const prev = num(q.prevclose);
        const price = num(q.last) || prev; // last is null before the first trade of the day
        if (!price) continue;
        out[String(q.symbol)] = {
          symbol: String(q.symbol),
          name: String(q.description ?? q.symbol),
          price,
          prevClose: prev,
          change: price - prev,
          changePct: prev > 0 ? (price - prev) / prev : 0,
        };
      }
      return out;
    },
    async expirations(symbol) {
      const hit = expCache.get(symbol);
      if (hit && Date.now() - hit.at < HOUR) return hit.dates;
      const json = await get("/markets/options/expirations", { symbol });
      const dates = arr<string>(json.expirations?.date);
      expCache.set(symbol, { at: Date.now(), dates });
      return dates;
    },
    async intraday(symbol) {
      // ask for a few days so weekends and holidays still return the last session
      const json = await get("/markets/timesales", {
        symbol,
        interval: "1min",
        start: `${day(-5)} 09:30`,
        session_filter: "open",
      });
      const rows = arr<Record<string, unknown>>(json.series?.data);
      const last = String(rows.at(-1)?.time ?? "").slice(0, 10);
      return rows
        .filter((r) => String(r.time).startsWith(last))
        .map((r) => ({
          t: num(r.timestamp) * 1000,
          o: num(r.open),
          h: num(r.high),
          l: num(r.low),
          c: num(r.close),
          v: num(r.volume),
        }));
    },
    async premarket(symbol): Promise<Bar[]> {
      const today = etDay();
      const json = await get("/markets/timesales", { symbol, interval: "1min", start: `${today} 04:00`, end: `${today} 09:29`, session_filter: "all" });
      return arr<Record<string, unknown>>(json.series?.data)
        .filter((r) => String(r.time).slice(0, 10) === today && String(r.time).slice(11, 16) < "09:30")
        .map((r) => ({ t: num(r.timestamp) * 1000, o: num(r.open), h: num(r.high), l: num(r.low), c: num(r.close), v: num(r.volume) }));
    },
    async daily(symbol) {
      const json = await get("/markets/history", { symbol, interval: "daily", start: day(-190) });
      return arr<Record<string, unknown>>(json.history?.day).map((r) => ({
        t: Date.parse(`${r.date}T21:00:00Z`),
        o: num(r.open),
        h: num(r.high),
        l: num(r.low),
        c: num(r.close),
        v: num(r.volume),
      }));
    },
    async chain(symbol, exp) {
      const json = await get("/markets/options/chains", { symbol, expiration: exp, greeks: "true" });
      return arr<Record<string, unknown>>(json.options?.option).map((o) => {
        const g = (o.greeks ?? {}) as Record<string, unknown>;
        return {
          occ: String(o.symbol),
          underlying: symbol,
          type: o.option_type === "put" ? "put" : "call",
          strike: num(o.strike),
          expiration: exp,
          bid: num(o.bid),
          ask: num(o.ask),
          last: num(o.last),
          volume: num(o.volume),
          openInterest: num(o.open_interest),
          // Fallback values; analytics re-derives IV and greeks from the live bid/ask.
          iv: num(g.mid_iv) || num(g.smv_vol),
          delta: num(g.delta),
          gamma: num(g.gamma),
          theta: num(g.theta),
          vega: num(g.vega),
        } satisfies OptionContract;
      });
    },
  };
}
