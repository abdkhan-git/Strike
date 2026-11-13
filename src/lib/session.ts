/**
 * US equity calendar and session clock. Pure, so pages and server code share it.
 * Full-day exchange holidays are listed through 2027; early closes (1 pm) are not modelled.
 */
const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** The New York calendar date of a moment, as YYYY-MM-DD. */
export const etDay = (ms: number = Date.now()) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** True for a weekday that is not an exchange holiday. `day` is YYYY-MM-DD. */
export function isTradingDay(day: string) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(day);
}

/** The date `n` trading days after `day` (n ≥ 1). */
export function addTradingDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  while (n > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isTradingDay(d.toISOString().slice(0, 10))) n--;
  }
  return d.toISOString().slice(0, 10);
}

/** Trading days after `from` up to and including `to` (both YYYY-MM-DD). */
export function tradingDaysBetween(from: string, to: string) {
  let n = 0;
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isTradingDay(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

/** Where the US equity session is right now, from the New York clock and the holiday list. */
export function session(now: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const mins = Number(p.hour) * 60 + Number(p.minute);
  const day = etDay(now.getTime());
  const holiday = HOLIDAYS.has(day);
  const state =
    !isTradingDay(day) || mins < 240 || mins >= 1200
      ? "Closed"
      : mins < 570
        ? "Pre-market"
        : mins < 960
          ? "Market open"
          : "After hours";
  return { state, time: `${p.hour}:${p.minute} ET`, holiday } as const;
}
