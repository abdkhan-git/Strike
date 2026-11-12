export const usd = (n: number, d = 2) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const signedUsd = (n: number, d = 2) => (n > 0 ? "+" : "") + usd(n, d);

export const pct = (n: number, d = 1) => (n * 100).toFixed(d) + "%";

export const signedPct = (n: number, d = 2) => (n > 0 ? "+" : "") + pct(n, d);

export const compact = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(0) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));

/** "12m ago", "3h ago", "2d ago" */
export const ago = (ms: number, now = Date.now()) => {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export const usdCompact = (n: number) => "$" + compact(n);

export const shortDate = (iso: string) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Nov 12, 2027" when the date is not in the current year, otherwise "Nov 12" */
export const dateLabel = (iso: string) =>
  iso.slice(0, 4) === String(new Date().getUTCFullYear())
    ? shortDate(iso)
    : new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const strikeLabel = (k: number) => (Number.isInteger(k) ? String(k) : k.toFixed(k * 10 === Math.round(k * 10) ? 1 : 2));

export const contractLabel = (c: { strike: number; type: "call" | "put"; expiration: string }) =>
  `${strikeLabel(c.strike)}${c.type === "call" ? "C" : "P"} ${shortDate(c.expiration)}`;
