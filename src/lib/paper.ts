import { dteOf } from "./analytics";
import { intrinsic } from "./bs";
import type { IdeaCheck, PaperCurve, PaperStats, PaperTrade, PaperView } from "./desk";
import { exitRules, sellBy } from "./instruction";
import { chartOf, contractOf, provider } from "./market";
import { etDay } from "./session";
import { readPaper, writePaper } from "./store";
import type { Briefing } from "./types";

/**
 * Paper lab: every pick is bought on paper the moment it is made and then managed by
 * the same exit rules the app gives you, with no discretion:
 *
 *   entry    the ask at pick time, in the quantity the pick was sized to
 *   target   sold at the target price once the mid reaches it
 *   stop     sold at the mid once it falls to the stop (so a gap through the stop costs more)
 *   thesis   sold at the mid once the stock crosses the pick's invalidation price
 *   time     sold at the mid at the sell-by time
 *   expiry   settled at intrinsic value
 *
 * Prices are sampled once a minute while the app is running, so a move that comes and
 * goes inside a minute, or while the app is off, is not seen. The result answers one
 * question: what would following the picks exactly have made, in dollars?
 *
 * Go verdicts from the trade check (a queued Watch idea turning Go, or a signal alert sent
 * as BUY NOW) are tracked the same way, at the plan's size, once per contract per day.
 * They have no invalidation price, so they exit by target, stop, time or expiry only.
 * Picks and Go verdicts are reported separately: they are different claims.
 */

export async function openPaper(b: Briefing) {
  if (!b.picks.length) return;
  const rows = await readPaper();
  const have = new Set(rows.filter((r) => r.day === b.day && (r.source ?? "pick") === "pick").map((r) => r.occ));
  let added = 0;
  for (const p of b.picks) {
    const entry = p.contract.ask || p.contract.mid;
    if (have.has(p.contract.occ) || !(entry > 0)) continue;
    const r = exitRules(p.horizon);
    rows.push({
      id: `paper:${b.day}:${p.contract.occ}`,
      day: b.day,
      at: b.at,
      symbol: p.symbol,
      direction: p.direction,
      horizon: p.horizon,
      occ: p.contract.occ,
      type: p.contract.type,
      strike: p.contract.strike,
      expiration: p.contract.expiration,
      qty: Math.max(1, p.qty),
      entry,
      target: Math.ceil(entry * (1 + r.target) * 100) / 100,
      stop: Math.floor(entry * (1 - r.stop) * 100) / 100,
      sellByAt: sellBy(p.horizon, b.day, p.contract.expiration).at,
      invalidation: p.invalidation,
      status: "open",
      mark: p.contract.mid || entry,
      paused: b.paused,
      source: "pick",
    });
    added++;
  }
  if (added) await writePaper(rows.slice(-500));
}

/** Buys a Go verdict on paper, the first time that contract goes Go on a given day. */
export async function openPaperGo(c: IdeaCheck) {
  const k = c.contract;
  if (c.verdict !== "go" || !k || !c.horizon) return;
  const entry = k.ask || k.mid;
  if (!(entry > 0)) return;
  const day = etDay();
  const rows = await readPaper();
  if (rows.some((r) => r.source === "go" && r.day === day && r.occ === k.occ)) return;
  const r = exitRules(c.horizon);
  rows.push({
    id: `paper:go:${day}:${k.occ}`,
    day,
    at: Date.now(),
    symbol: c.idea.symbol,
    direction: k.type === "call" ? "bullish" : "bearish",
    horizon: c.horizon,
    occ: k.occ,
    type: k.type,
    strike: k.strike,
    expiration: k.expiration,
    // the plan's size, so every Go is measured on the same footing whatever was typed into Watch
    qty: Math.max(1, c.planSize?.qty ?? 1),
    entry,
    target: Math.ceil(entry * (1 + r.target) * 100) / 100,
    stop: Math.floor(entry * (1 - r.stop) * 100) / 100,
    sellByAt: sellBy(c.horizon, day, k.expiration).at,
    status: "open",
    mark: k.mid || entry,
    source: "go",
    score: c.score,
    entryTag: c.entry,
  });
  await writePaper(rows.slice(-500));
}

/** Marks open paper trades and closes any that hit an exit. Called by the watcher once a minute. */
export async function markPaper() {
  const rows = await readPaper();
  const open = rows.filter((r) => r.status === "open");
  if (!open.length) return;
  const now = Date.now();
  const quotes = await provider()
    .quotes([...new Set(open.map((r) => r.symbol))])
    .catch(() => ({}) as Record<string, { price: number }>);
  let changed = false;

  const close = (r: PaperTrade, exit: number, reason: PaperTrade["exitReason"]) => {
    r.status = "closed";
    r.exit = Math.max(0, Math.round(exit * 100) / 100);
    r.exitAt = now;
    r.exitReason = reason;
    r.mark = r.exit;
    changed = true;
  };

  for (const r of open) {
    if (dteOf(r.expiration, now) === 0) {
      const chart = await chartOf(r.symbol).catch(() => undefined);
      const last = chart?.daily.find((b) => etDay(b.t) === r.expiration)?.c ?? chart?.bars.at(-1)?.c ?? quotes[r.symbol]?.price;
      if (last) close(r, intrinsic(r.type, last, r.strike), "expiry");
      continue;
    }
    const spot = quotes[r.symbol]?.price;
    const c = spot ? await contractOf(r.symbol, r.expiration, r.occ, spot) : undefined;
    if (!c || !(c.mid > 0) || !spot) continue;
    if (r.mark !== c.mid) {
      r.mark = c.mid;
      changed = true;
    }
    const broken = r.invalidation !== undefined && (r.type === "call" ? spot < r.invalidation : spot > r.invalidation);
    if (c.mid >= r.target) close(r, r.target, "target");
    else if (c.mid <= r.stop) close(r, c.mid, "stop");
    else if (broken) close(r, c.mid, "thesis");
    else if (now >= r.sellByAt) close(r, c.mid, "time");
  }
  if (changed) await writePaper(rows);
}

export async function paperView(): Promise<PaperView> {
  const rows = await readPaper();
  const trades = rows
    .map((r) => {
      const px = r.status === "closed" ? (r.exit ?? 0) : (r.mark ?? r.entry);
      return { ...r, pnl: (px - r.entry) * 100 * r.qty, pnlPct: r.entry > 0 ? px / r.entry - 1 : 0 };
    })
    .sort((a, b) => b.at - a.at);
  const of = (source: "pick" | "go") => summarize(trades.filter((t) => (t.source ?? "pick") === source));
  return { trades, ...summarize(trades), groups: { pick: of("pick"), go: of("go") } };
}

function summarize(trades: PaperView["trades"]): { stats: PaperStats; curve: PaperCurve } {
  const closed = trades.filter((t) => t.status === "closed");
  const open = trades.filter((t) => t.status === "open");
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

  const byDay = new Map<string, number>();
  for (const t of closed) {
    const d = etDay(t.exitAt ?? t.at);
    byDay.set(d, (byDay.get(d) ?? 0) + t.pnl);
  }
  let cum = 0;
  const curve = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, pnl]) => ({ day, pnl, cum: (cum += pnl) }));

  return {
    stats: {
      n: trades.length,
      open: open.length,
      closed: closed.length,
      pnl: closed.reduce((s, t) => s + t.pnl, 0),
      openPnl: open.reduce((s, t) => s + t.pnl, 0),
      winRate: closed.length ? wins.length / closed.length : 0,
      avgWinPct: mean(wins.map((t) => t.pnlPct)),
      avgLossPct: mean(losses.map((t) => t.pnlPct)),
      expectancy: mean(closed.map((t) => t.pnl)),
    },
    curve,
  };
}
