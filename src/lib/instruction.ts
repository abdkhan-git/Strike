import { addTradingDays, etDay, isTradingDay, session } from "./session";
import type { Horizon, OptType } from "./types";

/**
 * Turns a contract into one exact instruction: what to buy, how many, the limit price,
 * when to place it, when to sell at the latest, the profit target and the stop.
 * Pure (no server imports), so pages and server code share the same numbers.
 *
 * Exit rules by how far out the contract expires:
 *   same day   target +40%  stop -30%  sell by 3:30 pm ET the same day
 *   ≤ 8 days   target +75%  stop -50%  hold up to 2 trading days, never into the last afternoon
 *   ≤ 45 days  target +100% stop -50%  hold up to 10 trading days, out a week before expiry
 *   longer     target +100% stop -50%  hold up to 15 trading days, out 3 weeks before expiry
 * The sell-by is never earlier than the next trading day for anything but same-day contracts.
 * Short-dated options lose value fastest, so they get smaller targets and shorter holds.
 */

export interface ExitRules {
  /** profit target as a share of the entry price, e.g. 0.75 */
  target: number;
  /** stop as a share of the entry price, e.g. 0.5 means sell at half */
  stop: number;
  holdDays: number;
  /** calendar days before expiry by which to be out */
  outBefore: number;
  /** ET minutes after midnight for the sell-by time */
  sellAt: number;
}

const RULES: Record<Horizon, ExitRules> = {
  eod: { target: 0.4, stop: 0.3, holdDays: 0, outBefore: 0, sellAt: 15 * 60 + 30 },
  week: { target: 0.75, stop: 0.5, holdDays: 2, outBefore: 0, sellAt: 15 * 60 },
  month: { target: 1, stop: 0.5, holdDays: 10, outBefore: 7, sellAt: 15 * 60 + 30 },
  quarter: { target: 1, stop: 0.5, holdDays: 15, outBefore: 21, sellAt: 15 * 60 + 30 },
};

export const horizonOfDte = (dte: number): Horizon => (dte < 1 ? "eod" : dte <= 8 ? "week" : dte <= 45 ? "month" : "quarter");
export const exitRules = (h: Horizon) => RULES[h];

// --- New York calendar helpers --------------------------------------------------

const etDate = (ms: number) => etDay(ms);

/** `n` trading days after `day` (weekends and exchange holidays skipped). */
const addWeekdays = (day: string, n: number) => (n > 0 ? addTradingDays(day, n) : day);

const nextWeekday = (day: string) => addTradingDays(day, 1);

/** `n` calendar days before `day`, moved back further to land on a trading day. */
function minusDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  while (!isTradingDay(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** ms for a New York wall-clock time on a date (offset taken from that date, so DST is right). */
function etTime(day: string, minutes: number) {
  const guess = Date.parse(`${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`);
  const shown = new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const [h, m] = shown.split(":").map(Number);
  return guess + (minutes - (h * 60 + m)) * 60_000;
}

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

/** When an order placed now would fill: during the session, now; otherwise at the next open. */
export function entryTiming(now = new Date()) {
  const { state, time } = session(now);
  const today = etDate(now.getTime());
  if (state === "Market open") return { day: today, when: "now", whenLong: "now, while the market is open" };
  if (state === "Pre-market") return { day: today, when: "at the open", whenLong: "at today's open, 9:30 am ET" };
  const earlyMorning = Number(time.slice(0, 2)) < 4;
  // before 4 am ET on a trading day the next open is later the same day; otherwise the next trading day
  const day = earlyMorning && isTradingDay(today) ? today : nextWeekday(today);
  return { day, when: `at the open ${dayLabel(day)}`, whenLong: `at the open on ${dayLabel(day)}, 9:30 am ET` };
}

/** Latest time to be out of a position entered on `entryDay`. */
export function sellBy(h: Horizon, entryDay: string, expiration: string) {
  const r = RULES[h];
  let day = h === "eod" ? entryDay : addWeekdays(entryDay, r.holdDays);
  const latest = h === "eod" ? expiration : minusDays(expiration, r.outBefore);
  // short-dated: never hold into the expiration afternoon; leave by 2 pm on expiry day at the latest
  let minutes = r.sellAt;
  if (day >= latest) {
    // never earlier than the next trading day: a multi-day contract needs at least a session to work
    const floor = h === "eod" ? entryDay : addWeekdays(entryDay, 1);
    day = latest < floor ? (floor <= expiration ? floor : expiration) : latest;
    if (h === "week" && day === expiration) minutes = 14 * 60;
  }
  return { at: etTime(day, minutes), day, text: `${dayLabel(day)}, ${clock(minutes)} ET` };
}

export interface Instruction {
  qty: number;
  limit: number;
  cost: number;
  when: string;
  whenLong: string;
  sellBy: { at: number; day: string; text: string };
  targetPrice: number;
  targetGain: number;
  targetPct: number;
  stopPrice: number;
  maxLoss: number;
  stopPct: number;
  /** cost of one contract is more than twice the budget */
  overBudget: boolean;
  headline: string;
  text: string;
}

type Contract = {
  underlying: string;
  type: OptType;
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  dte: number;
};

const money = (n: number) => `$${n.toFixed(2)}`;
const whole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const strikeText = (k: number) => (Number.isInteger(k) ? String(k) : k.toFixed(2).replace(/0$/, ""));
const expText = (exp: string) =>
  new Date(`${exp}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const contractText = (c: Pick<Contract, "underlying" | "type" | "strike" | "expiration">) =>
  `${c.underlying} $${strikeText(c.strike)} ${c.type === "call" ? "Call" : "Put"} exp ${expText(c.expiration)}`;

/**
 * The buy instruction for one contract. `budget` is the dollars to risk on the trade;
 * without one, the instruction is for a single contract.
 */
export function buyInstruction(c: Contract, opts: { budget?: number; horizon?: Horizon; now?: Date } = {}): Instruction {
  const h = opts.horizon ?? horizonOfDte(c.dte);
  const r = RULES[h];
  // limit a quarter of the way from mid to ask: fills most of the time without paying the full spread
  const mid = c.mid > 0 ? c.mid : c.ask;
  const limit = Math.max(c.bid, Math.ceil((mid + Math.max(0, c.ask - mid) * 0.25) * 100) / 100);
  const each = limit * 100;
  let qty = opts.budget ? Math.floor(opts.budget / each) : 1;
  const overBudget = !!opts.budget && each > opts.budget * 2;
  if (qty < 1) qty = 1;
  const cost = qty * each;
  const timing = entryTiming(opts.now);
  const by = sellBy(h, timing.day, c.expiration);
  const targetPrice = Math.ceil(limit * (1 + r.target) * 100) / 100;
  const stopPrice = Math.floor(limit * (1 - r.stop) * 100) / 100;
  const targetGain = (targetPrice - limit) * 100 * qty;
  const maxLoss = (limit - stopPrice) * 100 * qty;

  const headline = `Buy ${qty} × ${contractText(c)}`;
  const text =
    `${headline} at a limit of ${money(limit)} (${whole(cost)} total), ${timing.when}. ` +
    `Sell at ${money(targetPrice)} (+${Math.round(r.target * 100)}%, +${whole(targetGain)}) or by ${by.text}, whichever comes first. ` +
    `Cut it if it falls to ${money(stopPrice)} (−${whole(maxLoss)}).`;

  return {
    qty,
    limit,
    cost,
    when: timing.when,
    whenLong: timing.whenLong,
    sellBy: by,
    targetPrice,
    targetGain,
    targetPct: r.target,
    stopPrice,
    maxLoss,
    stopPct: r.stop,
    overBudget,
    headline,
    text,
  };
}
