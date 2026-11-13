import { cached } from "./cache";
import type { Headline } from "./types";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const THREE_DAYS = 3 * 86_400_000;

type FinnhubNews = { id: number; headline?: string; summary?: string; source?: string; url?: string; datetime?: number };

/**
 * Company headlines from the last three days, newest first, from two free sources merged:
 *
 *   Finnhub      company news API, free tier (60 requests a minute), needs FINNHUB_API_KEY
 *   Yahoo Finance  per-ticker RSS feed, free, no key; carries Reuters, WSJ, Bloomberg,
 *                Barron's, Investor's Business Daily and Yahoo's own desk
 *
 * Neither costs anything per request. The same story from both is shown once. Each source
 * is cached for 10 minutes, and a source that fails is simply left out, so callers never
 * need to guard.
 */
export function headlines(symbol: string): Promise<Headline[]> {
  return cached(`news2|${symbol}`, 10 * 60_000, async () => {
    const [a, b] = await Promise.all([finnhub(symbol), yahoo(symbol)]);
    const seen = new Set<string>();
    const out: Headline[] = [];
    for (const h of [...a, ...b].sort((x, y) => y.at - x.at)) {
      const k = norm(h.headline);
      if (!k || seen.has(k) || Date.now() - h.at > THREE_DAYS) continue;
      seen.add(k);
      out.push(h);
      if (out.length === 25) break;
    }
    return out;
  });
}

/** Lower-case letters and digits only, so the same headline from two feeds matches. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);

/** Only real web links: a headline feed must never hand the page a javascript: or data: address. */
const webUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);

async function finnhub(symbol: string): Promise<Headline[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${day(-3)}&to=${day(0)}`, {
      headers: { "X-Finnhub-Token": key },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) return [];
    return (raw as FinnhubNews[]).flatMap((n) => {
      const title = n.headline?.trim();
      const url = webUrl(n.url);
      return title && url ? [{ id: n.id, headline: title, summary: n.summary?.trim() ?? "", source: n.source ?? "", url, at: (n.datetime ?? 0) * 1000 }] : [];
    });
  } catch {
    return [];
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

/** A stable numeric id from a string, for the list keys. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The publisher from the link: "wsj.com" -> "WSJ"; Yahoo's own stories are "Yahoo Finance". */
function publisher(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host.endsWith("yahoo.com")) return "Yahoo Finance";
  const known: Record<string, string> = {
    "wsj.com": "WSJ",
    "reuters.com": "Reuters",
    "bloomberg.com": "Bloomberg",
    "barrons.com": "Barron's",
    "investors.com": "Investor's Business Daily",
    "marketwatch.com": "MarketWatch",
    "cnbc.com": "CNBC",
    "fool.com": "Motley Fool",
    "ft.com": "Financial Times",
    "nytimes.com": "New York Times",
    "businessinsider.com": "Business Insider",
  };
  return known[host] ?? host;
}

async function yahoo(symbol: string): Promise<Headline[]> {
  try {
    const res = await fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`, {
      // a generic client name; Yahoo refuses requests without one
      headers: { "User-Agent": "Mozilla/5.0 (compatible; StrikeNews/1.0)", Accept: "application/rss+xml, application/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: Headline[] = [];
    for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      const tag = (name: string) => decode(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "");
      const title = tag("title");
      const url = webUrl(tag("link"));
      const at = Date.parse(tag("pubDate"));
      if (!title || !url || !Number.isFinite(at)) continue;
      out.push({ id: hash(url), headline: title, summary: tag("description"), source: publisher(url), url, at });
    }
    return out;
  } catch {
    return [];
  }
}
