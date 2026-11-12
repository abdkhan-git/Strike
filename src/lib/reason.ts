import { compact, pct, shortDate, signedPct } from "./format";
import type { Catalyst, Enriched } from "./types";

/**
 * One-line read of why a contract stands out. Every clause restates a measured figure
 * (volume, open interest, where the last trade printed, the symbol's call/put split),
 * so it explains the demand without forecasting the stock.
 */
export function whyContract(c: Enriched, ctx: { spot: number; flowBias: number; catalyst?: Catalyst }): string {
  const parts: string[] = [];

  if (c.volOi >= 1)
    parts.push(
      `${compact(c.volume)} traded against ${compact(c.openInterest)} open (${c.volOi.toFixed(1)}×), so most of today's volume is new positions`,
    );
  else parts.push(`${compact(c.volume)} traded today, ${pct(c.volOi, 0)} of open interest`);

  if (c.lastPos >= 0.7) parts.push("last print near the ask, buyers paying up");
  else if (c.lastPos <= 0.3) parts.push("last print near the bid, which points to selling");

  const callShare = (ctx.flowBias + 1) / 2;
  const sideShare = c.type === "call" ? callShare : 1 - callShare;
  if (sideShare >= 0.575) parts.push(`${c.type}s are ${pct(sideShare, 0)} of ${c.underlying} premium`);
  else if (sideShare <= 0.425)
    parts.push(`runs against a tape that is ${pct(1 - sideShare, 0)} ${c.type === "call" ? "puts" : "calls"}`);

  if (ctx.catalyst?.kind === "earnings" && ctx.catalyst.date && ctx.catalyst.date <= c.expiration)
    parts.push(`earnings ${shortDate(ctx.catalyst.date)} lands before expiry`);

  if (ctx.spot > 0) parts.push(`needs ${signedPct(c.breakeven / ctx.spot - 1, 1)} to break even`);

  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}
