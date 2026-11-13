import { cached } from "./cache";
import type { Headline } from "./types";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type FinnhubNews = { id: number; headline?: string; summary?: string; source?: string; url?: string; datetime?: number };

/**
 * Company headlines from the last three days, newest first (Finnhub, free tier 60 requests/min).
 * Returns an empty list without a key or when the request fails, so callers never need to guard.
 */
export function headlines(symbol: string): Promise<Headline[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return Promise.resolve([]);
  return cached(`news|${symbol}`, 10 * 60_000, async () => {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${day(-3)}&to=${day(0)}`,
        { headers: { "X-Finnhub-Token": key }, cache: "no-store" },
      );
      if (!res.ok) return [];
      const raw: unknown = await res.json();
      if (!Array.isArray(raw)) return [];
      const seen = new Set<string>();
      const out: Headline[] = [];
      for (const n of (raw as FinnhubNews[]).sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))) {
        const title = n.headline?.trim();
        // only real web links: a headline feed must never hand the page a javascript: or data: address
        if (!title || !n.url || !/^https?:\/\//i.test(n.url) || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        out.push({
          id: n.id,
          headline: title,
          summary: n.summary?.trim() ?? "",
          source: n.source ?? "",
          url: n.url,
          at: (n.datetime ?? 0) * 1000,
        });
        if (out.length === 20) break;
      }
      return out;
    } catch {
      return [];
    }
  });
}
