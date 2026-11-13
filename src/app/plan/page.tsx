"use client";

import clsx from "clsx";
import { useState } from "react";
import { GoalPanel } from "@/components/GoalPanel";
import { PicksSection } from "@/components/PicksSection";
import { PnlCalendar } from "@/components/PnlCalendar";
import { toast } from "@/components/Toaster";
import { Badge, Bullets, Button, Page, PageError, PageHeader, PageSkeleton, Panel, PanelHeader, fieldClass } from "@/components/ui";
import { pct, signedUsd, usd } from "@/lib/format";
import { STYLES, styleOf } from "@/lib/styles";
import type { PlanSettings, PlanStyle, PlanView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

export default function PlanPage() {
  const { data, error, reload } = usePoll<PlanView>("/api/plan", 15_000);
  const [editing, setEditing] = useState(false);

  if (!data) return error ? <PageError message={error} /> : <PageSkeleton label="Building today's plan…" />;

  const p = data.settings;

  return (
    <Page>
      <PageHeader
        eyebrow={<Badge tone="mute">{styleOf(p.style).label} style</Badge>}
        title="Plan"
        subtitle="Your goal, what it asks of today, every day's result, and today's picks sized to your limits."
        right={<Button onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit goal and limits"}</Button>}
      />

      {editing && (
        <Settings
          value={p}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}

      <GoalPanel plan={data} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <PnlCalendar days={data.days} needToday={data.needToday} />
        <Today plan={data} />
      </div>

      <StylePicker value={p} onSaved={reload} />

      <PicksSection paused={data.halted || data.budget <= 0} needToday={data.needToday} />
    </Page>
  );
}

/** What today allows: size of the next trade, how much of the daily loss limit is used, slots, and the day's rules. */
function Today({ plan }: { plan: PlanView }) {
  const p = plan.settings;
  const dayStart = Math.max(1, plan.equity - plan.todayPnl - plan.todayOpenPnl);
  const limit = p.dailyLossLimit * dayStart;
  const lost = Math.max(0, -(plan.todayPnl + Math.min(0, plan.todayOpenPnl)));
  const used = Math.min(1, lost / Math.max(limit, 1));
  const slots = Array.from({ length: p.maxOpen }, (_, i) => i < plan.openCount);

  return (
    <Panel>
      <PanelHeader title="Today" right={plan.halted ? <Badge tone="down">Paused</Badge> : plan.budget <= 0 ? <Badge tone="warn">Slots full</Badge> : <Badge tone="up">Clear to trade</Badge>} />
      <div className="space-y-5 px-5 py-5">
        <div>
          <div className="text-[12px] text-muted">Risk on the next trade</div>
          <div className={clsx("num mt-1 text-[30px] font-semibold leading-none tracking-[-0.04em]", plan.budget <= 0 && "text-down")}>{usd(plan.budget, 0)}</div>
          <div className="mt-1.5 text-[12px] text-faint">
            {plan.budget > 0 ? `${pct(plan.budget / Math.max(plan.equity, 1), 1)} of the account · base ${pct(p.riskPerTrade, 0)}` : "no new trades until this clears"}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-muted">Daily loss limit</span>
            <span className="num text-faint">
              {usd(lost, 0)} of {usd(limit, 0)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-strong">
            <div className={clsx("h-full rounded-full transition-[width] duration-500", used >= 1 ? "bg-down" : used >= 0.6 ? "bg-warn" : "bg-fg")} style={{ width: `${used * 100}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[12px] text-muted">Position slots</div>
            <div className="mt-2 flex gap-1.5">
              {slots.map((taken, i) => (
                <span key={i} className={clsx("h-2 flex-1 rounded-full", taken ? "bg-fg" : "bg-line-strong")} />
              ))}
            </div>
            <div className="mt-1.5 text-[12px] text-faint">
              {plan.openCount} of {p.maxOpen} in use
            </div>
          </div>
          <div>
            <div className="text-[12px] text-muted">Last trading day</div>
            <div className={clsx("num mt-1 text-[17px] font-semibold", plan.lastDayPnl === undefined ? "text-faint" : plan.lastDayPnl >= 0 ? "text-up" : "text-down")}>
              {plan.lastDayPnl !== undefined ? signedUsd(plan.lastDayPnl, 0) : "—"}
            </div>
            <div className="text-[12px] text-faint">{plan.losingStreak ? `${plan.losingStreak} red day${plan.losingStreak === 1 ? "" : "s"} in a row` : "no losing streak"}</div>
          </div>
        </div>
      </div>
      <div className="border-t border-line px-5 py-4">
        <div className="mb-2 text-[12px] font-medium text-muted">Today&apos;s rules</div>
        <Bullets items={plan.notes} dot="bg-fg" className="!text-fg/90" />
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          Size halves after a losing day, halves again after three in a row, and goes to zero once today&apos;s loss reaches {pct(p.dailyLossLimit, 0)} or
          every slot is used. Picks follow your style ({styleOf(p.style).blurb}).
        </p>
      </div>
    </Panel>
  );
}

function Settings({ value, onSaved }: { value: PlanSettings; onSaved: () => void }) {
  const [f, setF] = useState({
    startCapital: String(value.startCapital),
    goal: String(value.goal),
    startDate: value.startDate,
    targetDate: value.targetDate,
    riskPerTrade: String(+(value.riskPerTrade * 100).toFixed(2)),
    dailyLossLimit: String(+(value.dailyLossLimit * 100).toFixed(2)),
    maxOpen: String(value.maxOpen),
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
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
      if (res.ok) {
        toast("Plan saved", "up");
        onSaved();
      } else setErr((await res.json().catch(() => ({}))).error ?? "Could not save");
    } catch {
      setErr("Could not reach the server");
    } finally {
      setBusy(false);
    }
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
    <Panel className="rise">
      <form onSubmit={save} className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4 xl:grid-cols-7">
        {fields.map(([k, label, type, unit]) => (
          <label key={k} className="block">
            <span className="text-[12px] text-muted">{label}</span>
            <span className="relative mt-1.5 block">
              <input type={type} step="any" required value={f[k]} onChange={set(k)} className={clsx(fieldClass, "num", unit && "pr-7")} />
              {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{unit}</span>}
            </span>
          </label>
        ))}
        <div className="col-span-2 flex items-center gap-3 md:col-span-4 xl:col-span-7">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save plan"}
          </Button>
          {err && <span className="text-[12.5px] text-down">{err}</span>}
        </div>
      </form>
    </Panel>
  );
}

/** Choosing a style rewrites risk per trade, the loss limit and slots, and re-ranks the picks. */
function StylePicker({ value, onSaved }: { value: PlanSettings; onSaved: () => void }) {
  const [busy, setBusy] = useState<PlanStyle | null>(null);
  const current = value.style ?? "steady";

  async function choose(style: PlanStyle) {
    if (style === current || busy) return;
    const preset = STYLES[style];
    if (preset.riskPerTrade >= 0.25 && !confirm(`${preset.label} puts ${Math.round(preset.riskPerTrade * 100)}% of the account on one trade. A single stop-out costs about half of that. Switch?`)) return;
    setBusy(style);
    try {
      const res = await fetch("/api/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...value, style, riskPerTrade: preset.riskPerTrade, dailyLossLimit: preset.dailyLossLimit, maxOpen: preset.maxOpen }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not switch style");
      await fetch("/api/picks?action=run", { method: "POST" }).catch(() => {});
      toast(`Switched to ${preset.label}`, "up");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not switch style", "down");
    } finally {
      setBusy(null);
      onSaved();
    }
  }

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.02em]">How hard to push</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(STYLES) as PlanStyle[]).map((k) => {
          const st = STYLES[k];
          const on = k === current;
          return (
            <button
              key={k}
              onClick={() => choose(k)}
              disabled={!!busy}
              aria-pressed={on}
              className={clsx("!rounded-2xl border px-5 py-4 text-left transition-colors", on ? "border-fg/60 bg-raised" : "border-line bg-panel hover:border-line-strong")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold">{st.label}</span>
                {busy === k ? <Badge tone="mute">Re-ranking…</Badge> : on ? <Badge>Current</Badge> : null}
              </div>
              <div className="mt-1 text-[12.5px] leading-snug text-muted">{st.blurb}</div>
              <div className="mt-3 flex items-center gap-2">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-line-strong">
                  <span
                    className={clsx("block h-full rounded-full", st.riskPerTrade >= 0.25 ? "bg-down" : st.riskPerTrade >= 0.1 ? "bg-warn" : "bg-up")}
                    style={{ width: `${Math.min(100, st.riskPerTrade * 100 * 1.3 + 4)}%` }}
                  />
                </span>
                <span className="num text-[11.5px] text-faint">stops at −{Math.round(st.dailyLossLimit * 100)}% a day</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
