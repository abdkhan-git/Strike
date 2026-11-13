import { brokerView } from "./broker";
import { pct, usd } from "./format";
import { tradeViews } from "./positions";
import { etDay, tradingDaysBetween } from "./session";
import { readPlan } from "./store";
import type { DayPnl, PlanSettings, PlanView, TradeView } from "./types";

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

/** Realized P/L per New York calendar day, oldest first. */
export function dailyPnl(trades: TradeView[]): DayPnl[] {
  const by = new Map<string, DayPnl>();
  for (const t of trades) {
    if (t.status !== "closed" || !t.exitAt) continue;
    const day = etDay(t.exitAt);
    const row = by.get(day) ?? { day, pnl: 0, trades: 0, wins: 0 };
    row.pnl += t.pnl;
    row.trades += 1;
    if (t.pnl > 0) row.wins += 1;
    by.set(day, row);
  }
  return [...by.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * Today's plan: where the account stands against the goal, what the goal asks of today,
 * and how much to risk on the next trade given recent results.
 *
 * Sizing rules: the base risk is `riskPerTrade` of the account. It is halved after a
 * losing day and halved again on a streak of three, never raised above the base, and
 * set to zero once the day's loss reaches `dailyLossLimit` or every slot is taken. The
 * goal never raises the size: being behind is not a reason to bet more.
 */
export async function buildPlan(settings: PlanSettings, trades: TradeView[], brokerEquity?: number): Promise<PlanView> {
  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status === "closed");
  const realized = closed.reduce((s, t) => s + t.pnl, 0);
  const openPnl = open.reduce((s, t) => s + t.pnl, 0);
  // a linked brokerage already marks every position, so its value is the account's equity
  const equity = brokerEquity && brokerEquity > 0 ? brokerEquity : settings.startCapital + realized + openPnl;

  const days = dailyPnl(trades);
  const today = etDay();
  const past = days.filter((d) => d.day !== today).reverse();
  const todayPnl = days.find((d) => d.day === today)?.pnl ?? 0;
  // positions opened today count toward the day's loss before they are closed
  const todayOpenPnl = open.filter((t) => etDay(t.entryAt) === today).reduce((s, t) => s + t.pnl, 0);
  const lastDayPnl = past[0]?.pnl;
  let losingStreak = 0;
  for (const d of past) {
    if (d.pnl >= 0) break;
    losingStreak++;
  }

  const total = Math.max(1, tradingDaysBetween(settings.startDate, settings.targetDate));
  const tradingDaysLeft = Math.max(1, tradingDaysBetween(today, settings.targetDate));
  const elapsed = Math.min(1, Math.max(0, (total - tradingDaysLeft) / total));
  const onPace = settings.startCapital * (settings.goal / settings.startCapital) ** elapsed;
  const reached = equity >= settings.goal;
  const requiredDaily = equity > 0 && !reached ? (settings.goal / equity) ** (1 / tradingDaysLeft) - 1 : 0;
  const needToday = equity * requiredDaily;
  const needWeek = equity * ((1 + requiredDaily) ** Math.min(5, tradingDaysLeft) - 1);

  const recent = days.slice(-20);
  const avgDay = recent.length ? recent.reduce((s, d) => s + d.pnl, 0) / recent.length : undefined;

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
  // the limit is measured against what the account was worth this morning
  const dayLoss = Math.min(0, todayPnl + Math.min(0, todayOpenPnl));
  const dayStart = Math.max(1, equity - todayPnl - todayOpenPnl);
  const halted = dayLoss <= -settings.dailyLossLimit * dayStart;
  if (halted) notes.push(`Down ${usd(-dayLoss)} today, past the ${pct(settings.dailyLossLimit, 0)} daily limit. No new trades today.`);
  const slots = Math.max(0, settings.maxOpen - open.length);
  if (!slots) notes.push(`All ${settings.maxOpen} position slots are in use. Close one before opening another.`);
  if (reached) notes.push("The goal is reached. Consider lowering risk per trade to protect it.");
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
    needToday,
    needWeek,
    todayPnl,
    todayOpenPnl,
    lastDayPnl,
    losingStreak,
    openCount: open.length,
    budget,
    notes,
    halted,
    days,
    avgDay,
    winDays: days.filter((d) => d.pnl > 0).length,
    lossDays: days.filter((d) => d.pnl < 0).length,
  };
}

/** Today's plan from the saved settings (or defaults seeded from the brokerage value) and the trade log. */
export async function currentPlan(trades?: TradeView[]): Promise<PlanView> {
  const broker = await brokerView();
  const total = broker.accounts.reduce((s, a) => s + (a.total ?? 0), 0);
  const settings = (await readPlan()) ?? defaultPlan(total > 0 ? Math.round(total) : undefined);
  return buildPlan(settings, trades ?? (await tradeViews()), total);
}
