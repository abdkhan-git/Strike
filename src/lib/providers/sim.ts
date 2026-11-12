import { bsGreeks, bsPrice } from "../bs";
import type { Bar, Catalyst, OptionContract, Provider, Quote } from "../types";

/**
 * Simulated feed. Prices, volumes and catalysts are GENERATED, not market data.
 * It exists so the app is usable before a real data key is configured.
 */

type Seed = { symbol: string; name: string; price: number; iv: number; cat?: ["earnings" | "news" | "flow", number] };

const UNIVERSE: Seed[] = [
  { symbol: "NVDA", name: "NVIDIA", price: 182, iv: 0.52, cat: ["earnings", 6] },
  { symbol: "TSLA", name: "Tesla", price: 412, iv: 0.61, cat: ["news", 0] },
  { symbol: "AAPL", name: "Apple", price: 268, iv: 0.27 },
  { symbol: "AMD", name: "Advanced Micro Devices", price: 231, iv: 0.55, cat: ["flow", 0] },
  { symbol: "PLTR", name: "Palantir", price: 174, iv: 0.68, cat: ["news", 0] },
  { symbol: "META", name: "Meta Platforms", price: 648, iv: 0.34 },
  { symbol: "AMZN", name: "Amazon", price: 244, iv: 0.31 },
  { symbol: "MSFT", name: "Microsoft", price: 506, iv: 0.25 },
  { symbol: "GOOGL", name: "Alphabet", price: 291, iv: 0.3 },
  { symbol: "WMT", name: "Walmart", price: 104, iv: 0.29, cat: ["earnings", 5] },
  { symbol: "TGT", name: "Target", price: 91, iv: 0.47, cat: ["earnings", 7] },
  { symbol: "HD", name: "Home Depot", price: 371, iv: 0.3, cat: ["earnings", 5] },
  { symbol: "BABA", name: "Alibaba", price: 163, iv: 0.5, cat: ["earnings", 2] },
  { symbol: "DIS", name: "Walt Disney", price: 108, iv: 0.38, cat: ["earnings", 1] },
  { symbol: "COIN", name: "Coinbase", price: 297, iv: 0.74, cat: ["flow", 0] },
  { symbol: "MSTR", name: "Strategy", price: 233, iv: 0.82 },
  { symbol: "SMCI", name: "Super Micro Computer", price: 39, iv: 0.86, cat: ["news", 0] },
  { symbol: "NFLX", name: "Netflix", price: 112, iv: 0.36 },
  { symbol: "INTC", name: "Intel", price: 37, iv: 0.58, cat: ["flow", 0] },
  { symbol: "SOFI", name: "SoFi Technologies", price: 29, iv: 0.66 },
  { symbol: "HOOD", name: "Robinhood", price: 131, iv: 0.72, cat: ["news", 0] },
  { symbol: "SNOW", name: "Snowflake", price: 262, iv: 0.6, cat: ["earnings", 13] },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", price: 681, iv: 0.16 },
  { symbol: "QQQ", name: "Invesco QQQ", price: 621, iv: 0.21 },
];

const CAT_LABEL = { earnings: "Earnings", news: "Elevated news flow", flow: "Unusual options activity" } as const;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(symbol: string): Seed {
  const known = UNIVERSE.find((u) => u.symbol === symbol);
  if (known) return known;
  const r = rng(hash(symbol));
  return { symbol, name: symbol, price: Math.round(15 + r() * 320), iv: 0.3 + r() * 0.5 };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function catalystOf(seed: Seed): Catalyst | undefined {
  if (!seed.cat) return undefined;
  const [kind, days] = seed.cat;
  const d = new Date(Date.now() + days * 86_400_000);
  return { kind, label: CAT_LABEL[kind], date: kind === "earnings" ? iso(d) : undefined };
}

function priceNow(seed: Seed, at = Date.now()) {
  const t = at / 1000;
  const p = hash(seed.symbol) % 628;
  const k = seed.iv / 0.5;
  const drift =
    0.014 * k * Math.sin(t / 211 + p) + 0.006 * k * Math.sin(t / 37 + p * 1.7) + 0.002 * k * Math.sin(t / 5 + p * 2.3);
  const dayBias = ((hash(seed.symbol + iso(new Date())) % 600) - 300) / 10000;
  return seed.price * (1 + dayBias + drift);
}

function quoteOf(symbol: string): Quote {
  const seed = seedOf(symbol);
  const price = priceNow(seed);
  const change = price - seed.price;
  return { symbol, name: seed.name, price, prevClose: seed.price, change, changePct: change / seed.price };
}

/** Weekly Friday expirations; index ETFs also list every weekday for the next week. */
function expirationsOf(symbol: string, n: number) {
  const daily = symbol === "SPY" || symbol === "QQQ";
  const out: string[] = [];
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  for (let i = 0, fridays = 0; fridays < n; i++) {
    const dow = d.getUTCDay();
    if (dow === 5) fridays++;
    if (dow === 5 || (daily && i < 7 && dow >= 1 && dow <= 4)) out.push(iso(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function occ(symbol: string, exp: string, type: "call" | "put", strike: number) {
  return `${symbol}${exp.slice(2).replace(/-/g, "")}${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

function chainOf(symbol: string, exp: string): OptionContract[] {
  const seed = seedOf(symbol);
  const S = priceNow(seed);
  const now = Date.now();
  const dte = Math.max((Date.parse(exp + "T21:00:00Z") - now) / 86_400_000, 0.02);
  const T = dte / 365;
  const step = S < 20 ? 0.5 : S < 60 ? 1 : S < 200 ? 2.5 : S < 500 ? 5 : 10;
  const atm = Math.round(S / step) * step;

  const cat = catalystOf(seed);
  const earningsInside = cat?.date && cat.date <= exp;
  const term = earningsInside ? 1 + 0.45 * Math.sqrt(7 / Math.max(dte, 2)) : 1;

  const h = hash(symbol);
  const liq = 1500 + (h % 30000) + (seed.cat ? 12000 : 0);
  // directional tilt: mostly persistent per symbol, partly specific to the expiration
  const bull = 0.6 * (((h >>> 3) % 100) / 100) + 0.4 * ((hash(`${symbol}|${exp}`) % 100) / 100);
  const dayFrac = 0.35 + 0.65 * ((now % 86_400_000) / 86_400_000);
  const decay = 1 / (1 + dte / 12);

  const out: OptionContract[] = [];
  for (let i = -14; i <= 14; i++) {
    const K = +(atm + i * step).toFixed(2);
    if (K <= 0) continue;
    const m = Math.log(K / S);
    const iv = Math.max(0.08, seed.iv * term * (1 - 0.5 * m + 2.2 * m * m));
    for (const type of ["call", "put"] as const) {
      const r = rng(hash(`${symbol}|${exp}|${K}|${type}`));
      const mid = bsPrice(type, S, K, T, iv);
      const sp = 0.015 + Math.abs(m) * 0.35 + r() * 0.02;
      const bid = Math.max(0.01, +(mid * (1 - sp / 2)).toFixed(2));
      const ask = Math.max(bid + 0.01, +(mid * (1 + sp / 2)).toFixed(2));
      const otm = type === "call" ? m >= -0.01 : m <= 0.01;
      const shape = Math.exp(-((m / 0.07) ** 2)) * (otm ? 1 : 0.35) * (K % (step * 2) === 0 ? 1.4 : 1);
      const oi = Math.round(liq * decay * shape * (0.4 + r() * 1.2));
      const tilt = type === "call" ? 0.4 + 1.4 * bull : 1.8 - 1.4 * bull;
      let vol = oi * (0.12 + r() * 0.45) * dayFrac * tilt;
      if (r() < (seed.cat ? 0.09 : 0.03)) vol *= 4 + r() * 9; // sweep / block activity
      const g = bsGreeks(type, S, K, T, iv);
      out.push({
        occ: occ(symbol, exp, type, K),
        underlying: symbol,
        type,
        strike: K,
        expiration: exp,
        bid,
        ask,
        last: +(bid + (ask - bid) * r()).toFixed(2),
        volume: Math.round(vol),
        openInterest: oi,
        iv,
        ...g,
      });
    }
  }
  return out;
}

export const simProvider: Provider = {
  info: {
    name: "Simulated",
    simulated: true,
    realtime: false,
    note: "Generated data, not market prices. Add a Tradier token in .env.local for real data.",
  },
  async universe() {
    return UNIVERSE.map((u) => ({ symbol: u.symbol, catalyst: catalystOf(u) }));
  },
  async quotes(symbols) {
    return Object.fromEntries(symbols.map((s) => [s, quoteOf(s)]));
  },
  async expirations(symbol) {
    return expirationsOf(symbol, 10);
  },
  async chain(symbol, exp) {
    return chainOf(symbol, exp);
  },
  async intraday(symbol) {
    // the last four hours of generated one-minute bars, whatever the clock says
    const seed = seedOf(symbol);
    const end = Math.floor(Date.now() / 60_000) * 60_000;
    const out: Bar[] = [];
    for (let t = end - 240 * 60_000; t <= end; t += 60_000) {
      const o = priceNow(seed, t);
      const c = priceNow(seed, Math.min(t + 60_000, Date.now()));
      const mid = priceNow(seed, t + 30_000);
      const r = rng(hash(`${symbol}|${t}`));
      out.push({ t, o, h: Math.max(o, c, mid), l: Math.min(o, c, mid), c, v: Math.round(20_000 + r() * 180_000) });
    }
    return out;
  },
  async daily(symbol) {
    const seed = seedOf(symbol);
    const r = rng(hash(`${symbol}|daily`));
    const closes = [seed.price];
    // walk backwards from the previous close so the series ends where the quote starts
    for (let i = 0; i < 125; i++) closes.unshift(closes[0] / (1 + (r() - 0.48) * seed.iv * 0.12));
    const today = new Date();
    today.setUTCHours(21, 0, 0, 0);
    return closes.map((c, i) => {
      const o = i ? closes[i - 1] : c;
      return {
        t: today.getTime() - (closes.length - i) * 86_400_000,
        o,
        h: Math.max(o, c) * (1 + r() * 0.01),
        l: Math.min(o, c) * (1 - r() * 0.01),
        c,
        v: Math.round(5e6 + r() * 4e7),
      };
    });
  },
};
