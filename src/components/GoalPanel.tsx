"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateLabel, pct, signedUsd, usd, usdCompact } from "@/lib/format";
import { etDay } from "@/lib/session";
import type { PlanView } from "@/lib/types";
import { NumberTicker, Panel, Ring } from "./ui";

const DAY = 86_400_000;
const at = (day: string) => Date.parse(`${day}T12:00:00Z`);
const tick = { fill: "var(--c-faint)", fontSize: 11 };

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" | "warn" }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] text-muted">{label}</div>
      <div className={clsx("num mt-1 truncate text-[19px] font-semibold leading-none tracking-[-0.03em]", tone === "up" && "text-up", tone === "down" && "text-down", tone === "warn" && "text-warn")}>
        {value}
      </div>
      {sub && <div className="mt-1.5 truncate text-[11.5px] text-faint">{sub}</div>}
    </div>
  );
}

/**
 * The goal in one view: how far along the account is, where a steady path would have it
 * today, what that path asks of today and this week, and the account's actual line
 * against the path to the target date.
 */
export function GoalPanel({ plan }: { plan: PlanView }) {
  const p = plan.settings;
  const span = Math.max(p.goal - p.startCapital, 1);
  const progress = (plan.equity - p.startCapital) / span;
  const pace = (plan.onPace - p.startCapital) / span;
  const ahead = plan.equity >= plan.onPace;
  const reached = plan.equity >= p.goal;
  const gap = plan.equity - plan.onPace;

  const { data, todayT } = useMemo(() => {
    const t0 = at(p.startDate);
    const t1 = Math.max(at(p.targetDate), t0 + DAY);
    const path = (t: number) => p.startCapital * (p.goal / p.startCapital) ** Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const today = etDay();
    const todayT = Math.min(Math.max(at(today), t0), t1);

    // the account's value at the end of each traded day since the plan began, worked back from today
    const actual = new Map<number, number>();
    let value = plan.equity;
    actual.set(todayT, value);
    for (const d of [...plan.days].reverse()) {
      if (d.day < p.startDate) break;
      if (d.day < today) actual.set(at(d.day), value);
      value -= d.pnl;
    }
    if (!actual.has(t0)) actual.set(t0, p.startCapital);

    const times = new Set<number>(actual.keys());
    const step = Math.max(DAY, Math.round((t1 - t0) / 60 / DAY) * DAY);
    for (let t = t0; t < t1; t += step) times.add(t);
    times.add(t1);
    return {
      todayT,
      data: [...times].sort((a, b) => a - b).map((t) => ({ t, path: path(t), actual: actual.get(t) })),
    };
  }, [plan.days, plan.equity, p.startCapital, p.goal, p.startDate, p.targetDate]);

  const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const stretch = plan.requiredDaily > 0.01;

  return (
    <Panel>
      <div className="grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <div className="px-6 py-6">
          <div className="flex items-center gap-6">
            <Ring value={progress} mark={reached ? undefined : pace} size={136} stroke={10} tone={reached || ahead ? "up" : "warn"}>
              <div>
                <div className="num text-[26px] font-semibold leading-none tracking-[-0.04em]">{pct(Math.max(0, Math.min(1, progress)), 0)}</div>
                <div className="mt-1 text-[11px] text-faint">of the way</div>
              </div>
            </Ring>
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-muted">Account</div>
              <div className="num mt-1 text-[34px] font-semibold leading-none tracking-[-0.04em]">
                <NumberTicker value={plan.equity} format={(n) => usd(n, 0)} />
              </div>
              <div className="mt-2 text-[13px] text-muted">
                Goal <span className="num text-fg">{usd(p.goal, 0)}</span> by {dateLabel(p.targetDate)}
              </div>
              <div className={clsx("mt-2 inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium", reached || ahead ? "bg-up/12 text-up" : "bg-warn/12 text-warn")}>
                {reached ? "Goal reached" : `${signedUsd(gap, 0)} vs a steady path`}
              </div>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5">
            <Figure
              label="Needed today"
              value={reached ? "—" : `+${usd(plan.needToday, 0)}`}
              sub={reached ? "nothing: protect it" : `${pct(plan.requiredDaily, 2)} of the account, every trading day`}
              tone={stretch ? "warn" : undefined}
            />
            <Figure label="Needed this week" value={reached ? "—" : `+${usd(plan.needWeek, 0)}`} sub={`${plan.tradingDaysLeft} trading days left`} />
            <Figure
              label="Made today"
              value={signedUsd(plan.todayPnl, 0)}
              sub={plan.todayOpenPnl ? `${signedUsd(plan.todayOpenPnl, 0)} still open` : "realized"}
              tone={plan.todayPnl > 0 ? "up" : plan.todayPnl < 0 ? "down" : undefined}
            />
            <Figure
              label="Your average day"
              value={plan.avgDay !== undefined ? signedUsd(plan.avgDay, 0) : "—"}
              sub={plan.avgDay !== undefined ? `last ${Math.min(20, plan.days.length)} traded · ${plan.winDays} green, ${plan.lossDays} red all time` : "no closed trades yet"}
              tone={plan.avgDay === undefined ? undefined : plan.avgDay >= 0 ? "up" : "down"}
            />
          </div>

          {stretch && !reached && (
            <p className="mt-6 rounded-xl bg-warn/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-warn">
              This pace is {pct(plan.requiredDaily, 1)} a day, compounded, with no losing days. No strategy holds that. Strike sizes every trade to
              your risk limits, not to this number: being behind never makes a bet bigger.
            </p>
          )}
        </div>

        <div className="min-w-0 border-t border-line px-3 pb-3 pt-5 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between px-3">
            <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Path to the goal</h2>
            <div className="flex items-center gap-4 text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 rounded-full bg-fg" /> Account
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 border-t border-dashed border-faint" /> Steady path
              </span>
            </div>
          </div>
          <div className="mt-3 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--c-line)" />
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtDate} tick={tick} tickLine={false} axisLine={false} minTickGap={48} />
                <YAxis width={52} tickFormatter={(v) => usdCompact(Number(v))} tick={tick} tickLine={false} axisLine={false} domain={[(min: number) => Math.max(0, Math.floor(min * 0.9)), "auto"]} />
                <Tooltip
                  contentStyle={{ background: "var(--c-raised)", border: "1px solid var(--c-line-strong)", borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: "var(--c-muted)" }}
                  labelFormatter={(t) => fmtDate(Number(t))}
                  formatter={(v, name) => [usd(Number(v), 0), name === "actual" ? "Account" : "Steady path"]}
                />
                <Area dataKey="path" stroke="var(--c-faint)" strokeDasharray="4 4" strokeWidth={1.2} fill="var(--c-fg)" fillOpacity={0.03} dot={false} isAnimationActive={false} />
                <Line dataKey="actual" stroke="var(--c-fg)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <ReferenceDot x={todayT} y={plan.equity} r={4.5} fill={ahead ? "var(--c-up)" : "var(--c-warn)"} stroke="var(--c-panel)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Panel>
  );
}
