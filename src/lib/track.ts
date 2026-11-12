import { dteOf } from "./analytics";
import { intrinsic } from "./bs";
import { chartOf, contractOf, provider } from "./market";
import { readTrack, writeTrack } from "./store";
import type { Checkpoint, Signal, TrackBucket, TrackRecord, TrackView, TradePick } from "./types";

/**
 * Track record: every morning pick and every strong signal is recorded with the price
 * it could have been bought at (the ask), then scored on the same contract's mid price
 * one hour later, at that day's close, at the next day's close and at expiry. The best
 * price seen in between is kept too, which answers "did it ever hit +100%?".
 */

const HOUR = 3_600_000;
const etDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** 4:00 pm New York on a given date, in ms (handles daylight saving through the offset of that date). */
function closeOf(day: string) {
  const guess = Date.parse(`${day}T20:00:00Z`);
  const ny = new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" });
  return guess + (16 - Number(ny)) * HOUR;
}

/** Next weekday after `day`. Exchange holidays are not skipped. */
function nextWeekday(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function dueAt(r: TrackRecord, cp: Checkpoint) {
  if (cp === "h1") return r.at + HOUR;
  if (cp === "close") return closeOf(r.day);
  if (cp === "d1") return closeOf(nextWeekday(r.day));
  return closeOf(r.expiration);
}

const CHECKPOINTS: Checkpoint[] = ["h1", "close", "d1", "expiry"];

export async function recordPicks(picks: TradePick[]) {
  const rows = await readTrack();
  const day = etDay(Date.now());
  for (const p of picks)
    rows.push({
      id: `pick:${day}:${p.symbol}`,
      kind: "pick",
      day,
      at: Date.now(),
      symbol: p.symbol,
      direction: p.direction,
      horizon: p.horizon,
      conviction: p.conviction,
      score: p.score,
      occ: p.contract.occ,
      type: p.contract.type,
      strike: p.contract.strike,
      expiration: p.contract.expiration,
      entry: p.contract.ask || p.contract.mid,
      spotAtEntry: p.spot,
      marks: {},
      done: false,
    });
  await writeTrack(dedupe(rows));
}

/** Records strong signals the first time each appears in a day (same-day expiries excluded). */
export async function recordSignals(list: Signal[], minConviction = 70) {
  const rows = await readTrack();
  const seen = new Set(rows.map((r) => r.id));
  const day = etDay(Date.now());
  let added = 0;
  for (const s of list) {
    if (s.conviction < minConviction || !s.lead || s.horizon === "eod") continue;
    const id = `signal:${day}:${s.symbol}:${s.horizon}:${s.direction}`;
    if (seen.has(id)) continue;
    seen.add(id);
    added++;
    rows.push({
      id,
      kind: "signal",
      day,
      at: Date.now(),
      symbol: s.symbol,
      direction: s.direction,
      horizon: s.horizon,
      conviction: s.conviction,
      occ: s.lead.occ,
      type: s.lead.type,
      strike: s.lead.strike,
      expiration: s.lead.expiration,
      entry: s.lead.ask || s.lead.mid,
      spotAtEntry: s.price,
      marks: {},
      done: false,
    });
  }
  if (added) await writeTrack(rows);
}

const dedupe = (rows: TrackRecord[]) => [...new Map(rows.map((r) => [r.id, r])).values()];

let lastPeak = 0;

/**
 * Fills in any checkpoint that has come due and, every few minutes, updates the best
 * price seen. Called by the watcher once a minute.
 */
export async function scoreTrack() {
  const rows = await readTrack();
  const now = Date.now();
  const peakPass = now - lastPeak > 4 * 60_000;
  const open = rows.filter((r) => !r.done && (peakPass || CHECKPOINTS.some((cp) => !r.marks[cp] && dueAt(r, cp) <= now)));
  if (!open.length) return;
  if (peakPass) lastPeak = now;

  const symbols = [...new Set(open.map((r) => r.symbol))];
  const quotes = await provider().quotes(symbols).catch(() => ({}) as Record<string, { price: number }>);
  let changed = false;

  for (const r of open) {
    const expired = dteOf(r.expiration, now) === 0;
    let mark: number | undefined;
    if (expired && dueAt(r, "expiry") <= now) {
      // after expiry the option is worth its intrinsic value at the closing price
      const chart = await chartOf(r.symbol).catch(() => undefined);
      const close = chart?.daily.find((b) => etDay(b.t) === r.expiration)?.c ?? chart?.bars.at(-1)?.c;
      if (close) mark = intrinsic(r.type, close, r.strike);
    } else {
      const spot = quotes[r.symbol]?.price;
      const c = spot ? await contractOf(r.symbol, r.expiration, r.occ, spot) : undefined;
      if (c && c.mid > 0) mark = c.mid;
    }
    if (mark === undefined) continue;
    const ret = r.entry > 0 ? mark / r.entry - 1 : 0;

    for (const cp of CHECKPOINTS)
      if (!r.marks[cp] && dueAt(r, cp) <= now) {
        r.marks[cp] = { at: now, mark, ret };
        changed = true;
      }
    if (!r.peak || mark > r.peak.mark) {
      r.peak = { at: now, mark, ret };
      changed = true;
    }
    if (r.marks.expiry) r.done = true;
  }
  if (changed) await writeTrack(rows);
}

function bucket(label: string, rows: TrackRecord[]): TrackBucket {
  const at: TrackBucket["at"] = {};
  for (const cp of CHECKPOINTS) {
    const xs = rows.flatMap((r) => (r.marks[cp] ? [r.marks[cp]!.ret] : []));
    if (xs.length) at[cp] = { n: xs.length, avg: xs.reduce((s, x) => s + x, 0) / xs.length, win: xs.filter((x) => x > 0).length / xs.length };
  }
  const withPeak = rows.filter((r) => r.peak);
  return {
    label,
    n: rows.length,
    at,
    hit50: withPeak.length ? withPeak.filter((r) => r.peak!.ret >= 0.5).length / withPeak.length : 0,
    hit100: withPeak.length ? withPeak.filter((r) => r.peak!.ret >= 1).length / withPeak.length : 0,
  };
}

export async function trackView(): Promise<TrackView> {
  const rows = await readTrack();
  const picks = rows.filter((r) => r.kind === "pick");
  const sigs = rows.filter((r) => r.kind === "signal");
  const by = (xs: TrackRecord[], f: (r: TrackRecord) => boolean, label: string) => bucket(label, xs.filter(f));
  return {
    picks: [
      bucket("All picks", picks),
      by(picks, (r) => r.horizon === "week", "This-week expiries"),
      by(picks, (r) => r.horizon === "month" || r.horizon === "quarter", "1–2 month expiries"),
    ].filter((b) => b.n),
    signals: [
      bucket("All signals 70+", sigs),
      by(sigs, (r) => r.conviction >= 70 && r.conviction < 80, "Conviction 70–79"),
      by(sigs, (r) => r.conviction >= 80 && r.conviction < 90, "Conviction 80–89"),
      by(sigs, (r) => r.conviction >= 90, "Conviction 90+"),
      by(sigs, (r) => r.horizon === "week", "This week"),
      by(sigs, (r) => r.horizon === "month", "1 month"),
      by(sigs, (r) => r.horizon === "quarter", "2 months"),
    ].filter((b) => b.n),
    recent: [...picks].sort((a, b) => b.at - a.at).slice(0, 40),
  };
}
