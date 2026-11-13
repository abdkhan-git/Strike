"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pct, usd, usdCompact } from "@/lib/format";
import { Button, Panel, PanelHeader } from "./ui";

const tick = { fill: "var(--c-faint)", fontSize: 11 };
const RUNS = 3000;

/** Deterministic random numbers, so the same inputs always draw the same chart. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OddsInputs {
  /** share of trades that win, 0..1 */
  winRate: number;
  /** average gain on a winner, as a share of the money put on the trade */
  avgWin: number;
  /** average loss on a loser, same basis, positive */
  avgLoss: number;
  /** share of the account put on each trade */
  risk: number;
  tradesPerDay: number;
}

function simulate(start: number, goal: number, days: number, x: OddsInputs) {
  const rand = rng(Math.round(x.winRate * 1e4) ^ Math.round(x.avgWin * 1e4) ^ (Math.round(x.avgLoss * 1e4) << 8) ^ (Math.round(x.risk * 1e4) << 16) ^ days);
  const trades = Math.max(1, Math.round(days * x.tradesPerDay));
  const marks = Math.min(40, trades);
  const at = Array.from({ length: marks + 1 }, (_, i) => Math.round((i / marks) * trades));
  const paths: Float64Array[] = at.map(() => new Float64Array(RUNS));
  let reached = 0;
  let halved = 0;
  const ends = new Float64Array(RUNS);

  for (let r = 0; r < RUNS; r++) {
    let eq = start;
    let hit = false;
    let low = start;
    let m = 0;
    paths[0][r] = eq;
    for (let t = 1; t <= trades; t++) {
      // size follows the account, as the plan does; a trade under $20 is no longer a trade
      const stake = eq * x.risk;
      if (stake >= 20) eq += rand() < x.winRate ? stake * x.avgWin : -stake * x.avgLoss;
      if (eq >= goal) hit = true;
      if (eq < low) low = eq;
      if (t === at[m + 1]) paths[++m][r] = eq;
    }
    if (hit) reached++;
    if (low <= start * 0.5) halved++;
    ends[r] = eq;
  }
  const q = (xs: Float64Array, p: number) => {
    const s = Float64Array.from(xs).sort();
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  return {
    pReach: reached / RUNS,
    pHalved: halved / RUNS,
    median: q(ends, 0.5),
    low: q(ends, 0.1),
    high: q(ends, 0.9),
    fan: at.map((t, i) => ({ day: Math.round(t / x.tradesPerDay), p10: q(paths[i], 0.1), p50: q(paths[i], 0.5), band: [q(paths[i], 0.1), q(paths[i], 0.9)] as [number, number] })),
  };
}

function Slider({ label, value, set, min, max, step, show }: { label: string; value: number; set: (n: number) => void; min: number; max: number; step: number; show: string }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="num font-semibold text-fg">{show}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="mt-1.5" />
    </label>
  );
}

/**
 * Odds of the goal: thousands of random runs of the remaining trading days at a given win
 * rate, payoff and size. It shows what the goal really asks for, and what the same
 * settings risk on the way.
 */
export function GoalOdds({ start, goal, days, presets }: { start: number; goal: number; days: number; presets: { label: string; note: string; inputs: OddsInputs }[] }) {
  const [x, setX] = useState<OddsInputs>(presets[0].inputs);
  const [active, setActive] = useState(presets[0].label);
  const set = (k: keyof OddsInputs) => (n: number) => {
    setX((v) => ({ ...v, [k]: n }));
    setActive("");
  };
  const sim = useMemo(() => simulate(start, goal, days, x), [start, goal, days, x]);

  const edge = x.winRate * x.avgWin - (1 - x.winRate) * x.avgLoss;
  const breakeven = x.avgLoss / (x.avgWin + x.avgLoss);
  const tone = (p: number, good: number, ok: number) => (p >= good ? "text-up" : p >= ok ? "text-warn" : "text-down");

  return (
    <Panel>
      <PanelHeader title="Odds of the goal" sub={`${RUNS.toLocaleString("en-US")} simulated runs of the ${days} trading days left, from ${usd(start, 0)} to ${usd(goal, 0)}`} />
      <div className="grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant={active === p.label ? "primary" : "default"}
                title={p.note}
                onClick={() => {
                  setX(p.inputs);
                  setActive(p.label);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Slider label="Win rate" value={x.winRate} set={set("winRate")} min={0.2} max={0.8} step={0.01} show={pct(x.winRate, 0)} />
          <Slider label="Average winner" value={x.avgWin} set={set("avgWin")} min={0.1} max={1.5} step={0.05} show={`+${pct(x.avgWin, 0)}`} />
          <Slider label="Average loser" value={x.avgLoss} set={set("avgLoss")} min={0.1} max={1} step={0.05} show={`−${pct(x.avgLoss, 0)}`} />
          <Slider label="Account put on each trade" value={x.risk} set={set("risk")} min={0.01} max={0.5} step={0.01} show={pct(x.risk, 0)} />
          <Slider label="Trades a day" value={x.tradesPerDay} set={set("tradesPerDay")} min={0.2} max={3} step={0.1} show={x.tradesPerDay.toFixed(1)} />
          <p className={clsx("rounded-xl px-3.5 py-3 text-[12.5px] leading-relaxed", edge > 0 ? "bg-up/10 text-up" : "bg-down/10 text-down")}>
            {edge > 0
              ? `These numbers make ${pct(edge, 1)} of the stake per trade on average. With this payoff you need to win more than ${pct(breakeven, 0)} of the time just to break even.`
              : `These numbers lose ${pct(-edge, 1)} of the stake per trade on average: no size or number of trades turns that into a profit. With this payoff, break-even is a ${pct(breakeven, 0)} win rate.`}
          </p>
        </div>

        <div className="min-w-0 border-t border-line lg:border-l lg:border-t-0">
          <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
            {(
              [
                ["Reaches the goal", pct(sim.pReach, 0), tone(sim.pReach, 0.5, 0.2), "at any point before the date"],
                ["Loses half first", pct(sim.pHalved, 0), sim.pHalved <= 0.1 ? "text-up" : sim.pHalved <= 0.35 ? "text-warn" : "text-down", "account drops 50% along the way"],
                ["Typical finish", usd(sim.median, 0), sim.median >= start ? "text-fg" : "text-down", `1 in 10 below ${usdCompact(Math.max(0, sim.low))}, 1 in 10 above ${usdCompact(sim.high)}`],
              ] as const
            ).map(([label, value, cls, sub]) => (
              <div key={label} className="min-w-0 bg-panel px-5 py-4">
                <div className="truncate text-[12px] text-muted">{label}</div>
                <div className={clsx("num mt-1.5 truncate text-[24px] font-semibold leading-none tracking-[-0.035em]", cls)}>{value}</div>
                <div className="mt-1.5 truncate text-[11.5px] text-faint">{sub}</div>
              </div>
            ))}
          </div>
          <div className="h-[300px] px-2 pb-2 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={sim.fan} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--c-line)" />
                <XAxis dataKey="day" type="number" domain={[0, "dataMax"]} tickFormatter={(d) => `day ${d}`} tick={tick} tickLine={false} axisLine={false} minTickGap={50} />
                <YAxis width={54} scale="log" domain={["auto", "auto"]} allowDataOverflow tickFormatter={(v) => usdCompact(Number(v))} tick={tick} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--c-raised)", border: "1px solid var(--c-line-strong)", borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: "var(--c-muted)" }}
                  labelFormatter={(d) => `Trading day ${d}`}
                  formatter={(v, name) => (Array.isArray(v) ? [`${usd(Number(v[0]), 0)} – ${usd(Number(v[1]), 0)}`, "8 runs in 10"] : [usd(Number(v), 0), name === "p50" ? "Typical run" : String(name)])}
                />
                <Area dataKey="band" stroke="none" fill="var(--c-fg)" fillOpacity={0.08} isAnimationActive={false} />
                <Line dataKey="p50" stroke="var(--c-fg)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <ReferenceLine y={goal} stroke="var(--c-up)" strokeDasharray="4 4" label={{ value: "goal", position: "insideTopRight", fill: "var(--c-up)", fontSize: 11 }} />
                <ReferenceLine y={start} stroke="var(--c-faint)" strokeDasharray="2 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="border-t border-line px-5 py-3 text-[11.5px] leading-relaxed text-faint">
            Every trade is drawn independently at the win rate and payoff shown, sized as a share of the account at that moment. Real results come in streaks and
            real sizes are whole contracts, so treat these as a best case for the inputs, on a log scale. The shaded band holds 8 runs in 10.
          </p>
        </div>
      </div>
    </Panel>
  );
}
