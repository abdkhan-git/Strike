import { brokerView } from "./broker";
import { pct, usd } from "./format";
import { tradeViews } from "./positions";
import { readPlan } from "./store";
import type { PlanSettings, PlanView, TradeView } from "./types";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A year-long plan to 10x the starting amount; `startCapital` defaults to the linked account value when there is one. */
export function defaultPlan(startCapital = 10_000): PlanSettings {
  const start = new Date();
  const target = new Date(start);
  target.setUTCFullYear(target.getUTCFullYear() + 1);
  return {
    startCapital,
    goal: startCapital * 10,
    startDate: iso(start),
    targetDate: iso(target),
    riskPerTrade: 0.05,
    dailyLossLimit: 0.1,
    maxOpen: 4,
    style: "steady",
  };
}

/** Weekdays from `from` (exclusive) to `to` (inclusive). Exchange holidays are not removed. */
function tradingDays(from: Date, to: Date) {
  let n = 0;
  const d = new Date(from);
  d.setUTCHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(12, 0, 0, 0);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/**
 * Today's plan: where the account stands against the goal, how much to risk on the next
 * trade given recent results, and the strongest signals sized to that amount.
 *
 * Sizing rules: the base risk is `riskPerTrade` of the account. It is halved after a
 * losing day and halved again on a streak of three, never raised above the base, and
 * set to zero once the day's loss reaches `dailyLossLimit` or every slot is taken.
 */
export async function buildPlan(settings: PlanSettings, trades: TradeView[], brokerEquity?: number): Promise<PlanView> {
  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status === "closed");
  const realized = closed.reduce((s, t) => s + t.pnl, 0);
  const openPnl = open.reduce((s, t) => s + t.pnl, 0);
  // a linked brokerage already marks every position, so its value is the account's equity
  const equity = brokerEquity && brokerEquity > 0 ? brokerEquity : settings.startCapital + realized + openPnl;

  // realized P/L per calendar day, most recent first
  const byDay = new Map<string, number>();
  for (const t of closed) {
    const day = new Date(t.exitAt ?? 0).toLocaleDateString("en-CA");
    byDay.set(day, (byDay.get(day) ?? 0) + t.pnl);
  }
  const today = new Date().toLocaleDateString("en-CA");
  const past = [...byDay.entries()].filter(([d]) => d !== today).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const todayPnl = byDay.get(today) ?? 0;
  const lastDayPnl = past[0]?.[1];
  let losingStreak = 0;
  for (const [, pnl] of past) {
    if (pnl >= 0) break;
    losingStreak++;
  }

  const now = new Date();
  const start = new Date(settings.startDate + "T12:00:00Z");
  const target = new Date(settings.targetDate + "T12:00:00Z");
  const total = Math.max(1, tradingDays(start, target));
  const tradingDaysLeft = Math.max(1, tradingDays(now, target));
  const elapsed = Math.min(1, Math.max(0, (total - tradingDaysLeft) / total));
  const onPace = settings.startCapital * (settings.goal / settings.startCapital) ** elapsed;
  const requiredDaily = equity > 0 ? (settings.goal / equity) ** (1 / tradingDaysLeft) - 1 : 0;

  const notes: string[] = [];
  let factor = 1;
  if (lastDayPnl !== undefined && lastDayPnl < 0) {
    factor *= 0.5;
    notes.push(`Last trading day closed ${usd(lastDayPnl)}, so today's size is halved.`);
  }
  if (losingStreak >= 3) {
    factor *= 0.5;
    notes.push(`${losingStreak} losing days in a row: size is halved again until a winning day.`);
  }
  const halted = todayPnl <= -settings.dailyLossLimit * equity;
  if (halted) notes.push(`Down ${usd(-todayPnl)} today, past the ${pct(settings.dailyLossLimit, 0)} daily limit. No new trades today.`);
  const slots = Math.max(0, settings.maxOpen - open.length);
  if (!slots) notes.push(`All ${settings.maxOpen} position slots are in use. Close one before opening another.`);
  if (equity >= settings.goal) notes.push("The goal is reached. Consider lowering risk per trade to protect it.");
  else if (requiredDaily > 0.01)
    notes.push(
      `Reaching the goal needs ${pct(requiredDaily, 2)} compounded every trading day, far above what any strategy sustains. Treat the goal as a direction and the risk limits as the rules.`,
    );
  if (!notes.length) notes.push("No adjustments today: full size is available.");

  const budget = halted || !slots ? 0 : Math.max(0, equity * settings.riskPerTrade * factor);

  return {
    settings,
    equity,
    realized,
    openPnl,
    onPace,
    tradingDaysLeft,
    requiredDaily,
    todayPnl,
    lastDayPnl,
    losingStreak,
    openCount: open.length,
    budget,
    notes,
    halted,
  };
}

/** Today's plan from the saved settings (or defaults seeded from the brokerage value) and the trade log. */
export async function currentPlan(trades?: TradeView[]): Promise<PlanView> {
  const broker = await brokerView();
  const total = broker.accounts.reduce((s, a) => s + (a.total ?? 0), 0);
  const settings = (await readPlan()) ?? defaultPlan(total > 0 ? Math.round(total) : undefined);
  return buildPlan(settings, trades ?? (await tradeViews()), total);
}
