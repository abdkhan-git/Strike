import { cached } from "./cache";
import type { MarketContext, MarketEvent } from "./desk";
import { chartOf, provider, scan } from "./market";
import { etDay, isTradingDay, session } from "./session";
import { analyze } from "./thesis";

/**
 * Market context: the things a desk checks before any trade. Which way the index leans,
 * how much movement is priced in, and what is on the calendar.
 *
 * Scheduled events: Fed decision days are listed by hand (2026 only: the 2027 dates are
 * not in here yet, add them when published). The jobs report is taken as the first Friday
 * of the month and monthly options expiry as the third Friday; both are the usual rule,
 * not a confirmed calendar. CPI dates are not included.
 */
const FED_DAYS = ["2026-12-09"];

const iso = (d: Date) => d.toISOString().slice(0, 10);

function scheduled(today: string, horizonDays: number): MarketEvent[] {
  const out: MarketEvent[] = [];
  const start = new Date(`${today}T12:00:00Z`);
  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const day = iso(d);
    const dow = d.getUTCDay();
    const dom = d.getUTCDate();
    if (FED_DAYS.includes(day)) out.push({ date: day, label: "Fed rate decision, 2:00 pm ET", kind: "fed", inDays: i });
    if (dow === 5 && dom <= 7 && isTradingDay(day)) out.push({ date: day, label: "Jobs report, 8:30 am ET (usual schedule)", kind: "jobs", inDays: i });
    if (dow === 5 && dom >= 15 && dom <= 21) out.push({ date: day, label: "Monthly options expiry", kind: "opex", inDays: i });
    if (dow !== 0 && dow !== 6 && !isTradingDay(day)) out.push({ date: day, label: "Market closed (holiday)", kind: "holiday", inDays: i });
  }
  return out;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export function marketContext(): Promise<MarketContext> {
  return cached("context", 30_000, build, { stale: true });
}

async function build(): Promise<MarketContext> {
  const today = etDay();
  const [a, chart, rows, universe] = await Promise.all([
    analyze("SPY").catch(() => undefined),
    chartOf("SPY").catch(() => undefined),
    scan()
      .then((s) => s.rows)
      .catch(() => []),
    provider()
      .universe()
      .catch(() => []),
  ]);
  const spyRow = rows.find((r) => r.quote.symbol === "SPY");
  const score = a?.score ?? 0;
  const label = score >= 30 ? "Uptrend" : score <= -30 ? "Downtrend" : "Mixed";
  const atmIv = spyRow?.atmIv ?? 0;
  const realized = chart?.trend?.rv20;
  const vol = atmIv >= 0.3 ? "Stressed" : atmIv >= 0.2 ? "Elevated" : atmIv >= 0.13 ? "Normal" : "Calm";

  const events = scheduled(today, 10);
  for (const u of universe) {
    const c = u.catalyst;
    if (c?.kind !== "earnings" || !c.date) continue;
    const inDays = daysBetween(today, c.date);
    if (inDays >= 0 && inDays <= 5) events.push({ date: c.date, label: `${u.symbol} earnings`, kind: "earnings", inDays });
  }
  events.sort((x, y) => x.inDays - y.inDays || x.label.localeCompare(y.label));

  const cautions: string[] = [];
  const todayEvents = events.filter((e) => e.inDays === 0 && e.kind !== "earnings");
  for (const e of todayEvents) {
    if (e.kind === "fed") cautions.push("Fed decision today at 2:00 pm ET: prices can reverse hard in both directions around it. Avoid new short-dated trades before it.");
    if (e.kind === "jobs") cautions.push("Jobs report this morning: the first 30 minutes can be a head fake.");
    if (e.kind === "opex") cautions.push("Monthly options expiry today: prices tend to pin near big strikes and same-day premium decays fast.");
  }
  if (vol === "Stressed") cautions.push("Volatility is stressed: options are expensive and moves are large. Smaller size, wider stops.");
  if (label === "Mixed") cautions.push("The index has no clear trend: direction bets have less behind them than usual.");

  return {
    asOf: Date.now(),
    session: session(new Date()).state,
    regime: {
      label,
      score,
      note: a ? `SPY analysis ${score > 0 ? "+" : ""}${score}/100${a.reversal.signs.length ? `; warning: ${a.reversal.signs[0]}` : ""}` : "SPY analysis unavailable",
    },
    vol: {
      label: vol,
      atmIv,
      realized,
      note:
        realized && realized > 0 && atmIv > 0
          ? `Options price in ${(atmIv / realized).toFixed(1)}× the movement SPY has actually made over 20 days`
          : "Implied volatility of at-the-money SPY options",
    },
    spy: spyRow ? { price: spyRow.quote.price, changePct: spyRow.quote.changePct, expectedMovePct: spyRow.expectedMovePct, vsVwap: chart?.outlook?.vsVwap } : undefined,
    events: events.slice(0, 14),
    cautions,
  };
}
