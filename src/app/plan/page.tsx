"use client";

import clsx from "clsx";
import { useState } from "react";
import { PicksSection } from "@/components/PicksSection";
import { Button, Panel, Stat, StatStrip } from "@/components/ui";
import { dateLabel, pct, signedUsd, usd } from "@/lib/format";
import { STYLES, styleOf } from "@/lib/styles";
import type { PlanSettings, PlanStyle, PlanView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

export default function PlanPage() {
  const { data, error, reload } = usePoll<PlanView>("/api/plan", 15_000);
  const [editing, setEditing] = useState(false);

  if (!data) return <div className="p-6 text-muted">{error ? <span className="text-down">{error}</span> : "Building today's plan…"}</div>;

  const p = data.settings;
  const progress = Math.min(1, Math.max(0, (data.equity - p.startCapital) / Math.max(p.goal - p.startCapital, 1)));
  const pace = Math.min(1, Math.max(0, (data.onPace - p.startCapital) / Math.max(p.goal - p.startCapital, 1)));
  const ahead = data.equity >= data.onPace;

  return (
    <div className="mx-auto max-w-[1760px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Daily plan</h1>
          <p className="mt-0.5 text-muted">
            Where you stand against the goal, how hard to push, and today&apos;s picks sized to your style. Picks re-rank every 30 minutes and each one shows a live call.
          </p>
        </div>
        <Button onClick={() => setEditing((v) => !v)}>{editing ? "Close settings" : "Edit goal and limits"}</Button>
      </div>

      {editing && (
        <Settings
          value={p}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}

      <Panel className="px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <span className="num text-[28px] font-medium">{usd(data.equity)}</span>
            <span className="text-muted">
              of {usd(p.goal, 0)} by {dateLabel(p.targetDate)}
            </span>
          </div>
          <span className={clsx("text-[12.5px]", ahead ? "text-up" : "text-warn")}>
            {ahead ? "Ahead of" : "Behind"} a steady path ({usd(data.onPace, 0)} today) · {data.tradingDaysLeft} trading days left
          </span>
        </div>
        <div className="relative mt-3 h-2 bg-line-strong">
          <span className="absolute inset-y-0 left-0 bg-up" style={{ width: `${progress * 100}%` }} />
          <span className="absolute top-[-4px] h-4 w-px bg-fg" style={{ left: `${pace * 100}%` }} title="Steady path" />
        </div>
        <div className="num mt-1.5 flex justify-between text-[11px] text-faint">
          <span>{usd(p.startCapital, 0)} start</span>
          <span>{pct(progress, 0)} of the way</span>
          <span>{usd(p.goal, 0)}</span>
        </div>
      </Panel>

      <StatStrip>
        <Stat
          label="Risk on the next trade"
          value={usd(data.budget, 0)}
          sub={data.halted ? "trading paused for today" : `${pct(data.budget / Math.max(data.equity, 1), 1)} of the account`}
          tone={data.halted ? "down" : undefined}
        />
        <Stat
          label="Today"
          value={signedUsd(data.todayPnl)}
          sub={`limit ${usd(p.dailyLossLimit * data.equity, 0)} loss`}
          tone={data.todayPnl > 0 ? "up" : data.todayPnl < 0 ? "down" : undefined}
        />
        <Stat
          label="Last trading day"
          value={data.lastDayPnl !== undefined ? signedUsd(data.lastDayPnl) : "—"}
          sub={data.losingStreak ? `${data.losingStreak} losing day${data.losingStreak === 1 ? "" : "s"} in a row` : "no losing streak"}
          tone={data.lastDayPnl !== undefined ? (data.lastDayPnl >= 0 ? "up" : "down") : undefined}
        />
        <Stat label="Position slots" value={`${data.openCount} / ${p.maxOpen}`} sub={`${Math.max(0, p.maxOpen - data.openCount)} free`} />
      </StatStrip>

      <StylePicker value={p} onSaved={reload} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <PicksSection paused={data.halted || data.budget <= 0} />
        </div>
        <Panel>
          <div className="flex h-10 items-center border-b border-line px-4">
            <h2 className="cap !text-muted">Today&apos;s rules</h2>
          </div>
          <ul className="space-y-2 px-4 py-3 text-[12.5px] leading-snug">
            {data.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="mt-[7px] size-[3px] shrink-0 bg-fg" />
                {n}
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-3 text-[11.5px] leading-relaxed text-faint">
            Base risk is {pct(p.riskPerTrade, 0)} of the account per trade. It halves after a losing day, halves again after three
            in a row, and goes to zero once today&apos;s loss reaches {pct(p.dailyLossLimit, 0)} or every slot is used. Picks come
            from the day&apos;s one-sided option flow, follow your style ({styleOf(p.style).blurb}), and re-rank every 30
            minutes while the market is open.
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Settings({ value, onSaved }: { value: PlanSettings; onSaved: () => void }) {
  const [f, setF] = useState({
    startCapital: String(value.startCapital),
    goal: String(value.goal),
    startDate: value.startDate,
    targetDate: value.targetDate,
    riskPerTrade: String(value.riskPerTrade * 100),
    dailyLossLimit: String(value.dailyLossLimit * 100),
    maxOpen: String(value.maxOpen),
  });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...f,
        style: value.style,
        riskPerTrade: Number(f.riskPerTrade) / 100,
        dailyLossLimit: Number(f.dailyLossLimit) / 100,
      }),
    });
    if (res.ok) onSaved();
    else setErr((await res.json()).error ?? "Could not save");
  }

  const fields: [keyof typeof f, string, string, string?][] = [
    ["startCapital", "Starting amount", "number", "$"],
    ["goal", "Goal", "number", "$"],
    ["startDate", "Start date", "date"],
    ["targetDate", "Target date", "date"],
    ["riskPerTrade", "Risk per trade", "number", "%"],
    ["dailyLossLimit", "Daily loss limit", "number", "%"],
    ["maxOpen", "Max open positions", "number"],
  ];

  return (
    <Panel>
      <form onSubmit={save} className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 xl:grid-cols-7">
        {fields.map(([k, label, type, unit]) => (
          <label key={k} className="block">
            <span className="cap">{label}</span>
            <span className="relative mt-1 block">
              <input
                type={type}
                step="any"
                value={f[k]}
                onChange={set(k)}
                className="num h-8 w-full border border-line-strong bg-transparent px-2.5 text-[13px] focus:border-muted focus:outline-none [color-scheme:dark]"
              />
              {unit && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint">{unit}</span>}
            </span>
          </label>
        ))}
        <div className="col-span-2 flex items-center gap-3 md:col-span-4 xl:col-span-7">
          <Button type="submit" variant="primary">
            Save plan
          </Button>
          {err && <span className="text-[12px] text-down">{err}</span>}
        </div>
      </form>
    </Panel>
  );
}

/** Steady / Aggressive / All-in. Choosing one rewrites risk per trade, the loss limit and slots, and re-ranks the picks. */
function StylePicker({ value, onSaved }: { value: PlanSettings; onSaved: () => void }) {
  const [busy, setBusy] = useState<PlanStyle | null>(null);
  const current = value.style ?? "steady";

  async function choose(style: PlanStyle) {
    if (style === current) return;
    setBusy(style);
    const preset = STYLES[style];
    await fetch("/api/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...value, style, riskPerTrade: preset.riskPerTrade, dailyLossLimit: preset.dailyLossLimit, maxOpen: preset.maxOpen }),
    });
    await fetch("/api/picks?action=run", { method: "POST" });
    setBusy(null);
    onSaved();
  }

  return (
    <div className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
      {(Object.keys(STYLES) as PlanStyle[]).map((k) => {
        const st = STYLES[k];
        const on = k === current;
        return (
          <button
            key={k}
            onClick={() => choose(k)}
            disabled={!!busy}
            className={clsx("bg-panel px-4 py-3 text-left transition-colors", on ? "outline outline-1 -outline-offset-1 outline-fg" : "hover:bg-raised")}
          >
            <div className="flex items-center justify-between">
              <span className={clsx("text-[14px] font-semibold", k === "max" ? "text-down" : k === "aggressive" ? "text-warn" : "text-fg")}>{st.label}</span>
              <span className="cap">{busy === k ? "Re-ranking…" : on ? "Current" : "Switch"}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-muted">{st.blurb}</div>
            <div className="num mt-0.5 text-[11.5px] text-faint">daily loss limit {Math.round(st.dailyLossLimit * 100)}%</div>
          </button>
        );
      })}
    </div>
  );
}
