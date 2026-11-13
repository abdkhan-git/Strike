"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { signedUsd, usd } from "@/lib/format";
import { etDay, isTradingDay } from "@/lib/session";
import type { DayPnl } from "@/lib/types";
import { Panel } from "./ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** "-$1.4K" for cells too narrow for the full figure. */
const short = (n: number) => {
  const a = Math.abs(n);
  const body = a >= 10_000 ? `${(a / 1000).toFixed(0)}K` : a >= 1000 ? `${(a / 1000).toFixed(1)}K` : a.toFixed(0);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}$${body}`;
};

/**
 * Month view of realized P/L: one cell per trading day, tinted by how good or bad the day
 * was, with a total for each week. `needToday` is what the goal asks of one day, shown as
 * the bar a green day has to clear.
 */
export function PnlCalendar({ days, needToday }: { days: DayPnl[]; needToday?: number }) {
  const today = etDay();
  const [month, setMonth] = useState(today.slice(0, 7));
  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);

  const { weeks, total, traded, wins, best, worst, scale } = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1, 12));
    // back to the Monday on or before the 1st
    const start = new Date(first);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const weeks: { day: string; inMonth: boolean }[][] = [];
    const d = new Date(start);
    while (weeks.length < 6) {
      const week: { day: string; inMonth: boolean }[] = [];
      for (let i = 0; i < 7; i++) {
        if (i < 5) week.push({ day: iso(d), inMonth: d.getUTCMonth() === m - 1 });
        d.setUTCDate(d.getUTCDate() + 1);
      }
      if (week.some((c) => c.inMonth)) weeks.push(week);
      else if (weeks.length) break;
    }
    const inMonth = days.filter((x) => x.day.startsWith(month));
    return {
      weeks,
      total: inMonth.reduce((s, x) => s + x.pnl, 0),
      traded: inMonth.length,
      wins: inMonth.filter((x) => x.pnl > 0).length,
      best: inMonth.reduce<DayPnl | undefined>((a, b) => (!a || b.pnl > a.pnl ? b : a), undefined),
      worst: inMonth.reduce<DayPnl | undefined>((a, b) => (!a || b.pnl < a.pnl ? b : a), undefined),
      scale: Math.max(1, ...inMonth.map((x) => Math.abs(x.pnl))),
    };
  }, [month, days]);

  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(iso(new Date(Date.UTC(y, m - 1 + n, 1, 12))).slice(0, 7));
  };
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const firstMonth = days[0]?.day.slice(0, 7) ?? month;

  return (
    <Panel className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
        <div>
          <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Daily P/L</h2>
          <div className="mt-1 flex items-baseline gap-2.5">
            <span className={clsx("num text-[24px] font-semibold leading-none tracking-[-0.035em]", total > 0 ? "text-up" : total < 0 ? "text-down" : "text-fg")}>
              {traded ? signedUsd(total, 0) : "$0"}
            </span>
            <span className="text-[12px] text-faint">
              {label}
              {traded > 0 && ` · ${wins} green of ${traded} day${traded === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {month !== today.slice(0, 7) && (
            <button onClick={() => setMonth(today.slice(0, 7))} className="h-8 px-2.5 text-[12px] text-muted transition-colors hover:bg-hover hover:text-fg">
              Today
            </button>
          )}
          <button aria-label="Previous month" disabled={month <= firstMonth} onClick={() => shift(-1)} className="grid size-8 place-items-center !rounded-full text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <button aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => shift(1)} className="grid size-8 place-items-center !rounded-full text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-3 sm:px-4">
        <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,0.85fr)] gap-1.5">
          {[...WEEKDAYS, "Week"].map((w) => (
            <div key={w} className="px-1 pb-1 text-center text-[11px] font-medium text-faint">
              {w}
            </div>
          ))}
          {weeks.map((week) => {
            const weekRows = week.flatMap((c) => (c.inMonth && byDay.has(c.day) ? [byDay.get(c.day)!] : []));
            const weekTotal = weekRows.reduce((s, x) => s + x.pnl, 0);
            return [
              ...week.map((c) => {
                const r = c.inMonth ? byDay.get(c.day) : undefined;
                const isToday = c.day === today;
                const closed = !isTradingDay(c.day);
                const future = c.day > today;
                const strength = r ? Math.round((Math.abs(r.pnl) / scale) * 30 + 10) : 0;
                return (
                  <div
                    key={c.day}
                    title={r ? `${c.day}: ${signedUsd(r.pnl)} on ${r.trades} trade${r.trades === 1 ? "" : "s"}, ${r.wins} won` : closed && c.inMonth ? `${c.day}: market closed` : undefined}
                    className={clsx(
                      "flex h-[68px] flex-col justify-between rounded-xl px-2 py-1.5 sm:h-[76px] sm:px-2.5 sm:py-2",
                      !c.inMonth && "opacity-0",
                      !r && "bg-raised/45",
                      isToday && "ring-1 ring-fg/70",
                    )}
                    style={r ? { background: `color-mix(in srgb, var(${r.pnl >= 0 ? "--c-up" : "--c-down"}) ${strength}%, transparent)` } : undefined}
                  >
                    <span className={clsx("num text-[11px]", isToday ? "font-semibold text-fg" : future || closed ? "text-faint/60" : "text-faint")}>{Number(c.day.slice(8))}</span>
                    {r ? (
                      <span className="min-w-0">
                        <span className={clsx("num block truncate text-[12.5px] font-semibold sm:text-[13.5px]", r.pnl >= 0 ? "text-up" : "text-down")}>{short(r.pnl)}</span>
                        <span className="hidden truncate text-[10.5px] text-muted sm:block">
                          {r.trades} trade{r.trades === 1 ? "" : "s"}
                        </span>
                      </span>
                    ) : (
                      closed && c.inMonth && <span className="text-[10.5px] text-faint/60">Closed</span>
                    )}
                  </div>
                );
              }),
              <div key={`w${week[0].day}`} className="flex h-[68px] flex-col justify-end rounded-xl border border-line px-2 py-1.5 sm:h-[76px] sm:px-2.5 sm:py-2">
                {weekRows.length ? (
                  <>
                    <span className={clsx("num truncate text-[12.5px] font-semibold sm:text-[13.5px]", weekTotal >= 0 ? "text-up" : "text-down")}>{short(weekTotal)}</span>
                    <span className="hidden text-[10.5px] text-faint sm:block">
                      {weekRows.length} day{weekRows.length === 1 ? "" : "s"}
                    </span>
                  </>
                ) : (
                  <span className="text-[12px] text-faint/60">—</span>
                )}
              </div>,
            ];
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-[12px] text-muted">
        {best && best.pnl > 0 && (
          <span>
            Best day <span className="num text-up">{signedUsd(best.pnl, 0)}</span>
          </span>
        )}
        {worst && worst.pnl < 0 && (
          <span>
            Worst day <span className="num text-down">{signedUsd(worst.pnl, 0)}</span>
          </span>
        )}
        {needToday !== undefined && needToday > 0 && (
          <span>
            The goal asks for <span className="num text-fg">{usd(needToday, 0)}</span> a day at today&apos;s account size
          </span>
        )}
        {!traded && <span className="text-faint">No closed trades this month.</span>}
      </div>
    </Panel>
  );
}
