"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GoalOdds, type OddsInputs } from "@/components/GoalOdds";
import { Badge, Page, PageError, PageHeader, PageSkeleton, Panel, PanelHeader, Segmented, Stat, StatStrip } from "@/components/ui";
import type { PaperView } from "@/lib/desk";
import { contractLabel, pct, shortDate, signedPct, signedUsd, usd } from "@/lib/format";
import { etDay } from "@/lib/session";
import { styleOf } from "@/lib/styles";
import type { PlanView, TradeView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");
const tick = { fill: "var(--c-faint)", fontSize: 11 };
const REASON = { target: "Hit target", stop: "Stopped out", time: "Time exit", thesis: "Thesis broke", expiry: "Expired" } as const;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export default function LabPage() {
  const { data: paper, error } = usePoll<PaperView>("/api/paper", 10_000);
  const { data: plan } = usePoll<PlanView>("/api/plan", 30_000);
  const { data: trades } = usePoll<TradeView[]>("/api/trades", 60_000);
  const [group, setGroup] = useState<"all" | "pick" | "go">("all");

  const presets = useMemo(() => {
    if (!plan) return [];
    const style = styleOf(plan.settings.style);
    const risk = plan.settings.riskPerTrade;
    const out: { label: string; note: string; inputs: OddsInputs }[] = [
      {
        label: "Picks win half the time",
        note: "The exit rules for this-week contracts (+75% target, −50% stop) at a coin-flip win rate and your plan's size",
        inputs: { winRate: 0.5, avgWin: 0.75, avgLoss: 0.5, risk, tradesPerDay: Math.min(3, style.picks) },
      },
      { label: "Same, at 5% a trade", note: "The same payoff with a twentieth of the account on each trade", inputs: { winRate: 0.5, avgWin: 0.75, avgLoss: 0.5, risk: 0.05, tradesPerDay: 1 } },
    ];
    for (const [key, label] of [
      ["pick", "Paper picks so far"],
      ["go", "Go verdicts so far"],
    ] as const) {
      const g = paper?.groups[key].stats;
      if (g && g.closed >= 5 && g.avgWinPct > 0)
        out.push({
          label,
          note: `What the ${g.closed} closed paper trades have actually done`,
          inputs: { winRate: clamp(g.winRate, 0.2, 0.8), avgWin: clamp(g.avgWinPct, 0.1, 1.5), avgLoss: clamp(-g.avgLossPct, 0.1, 1), risk, tradesPerDay: 1 },
        });
    }
    const closed = (trades ?? []).filter((t) => t.status === "closed");
    if (closed.length >= 10) {
      const wins = closed.filter((t) => t.pnl > 0);
      const losses = closed.filter((t) => t.pnl <= 0);
      const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
      const days = new Set(closed.map((t) => etDay(t.exitAt ?? t.entryAt))).size;
      out.push({
        label: "Your trades so far",
        note: `Win rate and payoff of your ${closed.length} closed trades`,
        inputs: {
          winRate: clamp(wins.length / closed.length, 0.2, 0.8),
          avgWin: clamp(mean(wins.map((t) => t.pnlPct)), 0.1, 1.5),
          avgLoss: clamp(-mean(losses.map((t) => t.pnlPct)), 0.1, 1),
          risk,
          tradesPerDay: clamp(closed.length / Math.max(days, 1), 0.2, 3),
        },
      });
    }
    return out;
  }, [plan, paper, trades]);

  if (!paper || !plan) return error ? <PageError message={error} /> : <PageSkeleton label="Opening the lab…" />;

  const view = group === "all" ? paper : paper.groups[group];
  const s = view.stats;
  const curve = view.curve;
  const shown = group === "all" ? paper.trades : paper.trades.filter((t) => (t.source ?? "pick") === group);
  const total = s.pnl + s.openPnl;
  const what = group === "go" ? "Go verdict" : group === "pick" ? "pick" : "trade";

  return (
    <Page>
      <PageHeader
        eyebrow="Proof before money"
        title="Lab"
        subtitle="Every morning pick and every Go verdict is bought on paper the moment it is made and managed by the exact exit rules. This is what following Strike to the letter would have made, in dollars, and what your numbers say about reaching the goal."
        right={
          <Segmented
            value={group}
            onChange={setGroup}
            options={[
              { value: "all", label: `All ${paper.stats.n}` },
              { value: "pick", label: `Picks ${paper.groups.pick.stats.n}` },
              { value: "go", label: `Go verdicts ${paper.groups.go.stats.n}` },
            ]}
          />
        }
      />

      <StatStrip>
        <Stat
          label="Paper P/L"
          value={signedUsd(total, 0)}
          num={total}
          format={(n) => signedUsd(n, 0)}
          sub={s.n ? `${signedUsd(s.pnl, 0)} closed · ${signedUsd(s.openPnl, 0)} open` : `starts with the next ${what}`}
          tone={total > 0 ? "up" : total < 0 ? "down" : undefined}
        />
        <Stat label="Win rate" value={s.closed ? pct(s.winRate, 0) : "—"} sub={s.closed ? `${s.closed} closed, ${s.open} open` : "no closed paper trades yet"} />
        <Stat
          label="Average winner / loser"
          value={s.closed ? `${signedPct(s.avgWinPct, 0)} / ${signedPct(s.avgLossPct, 0)}` : "—"}
          sub={s.closed ? `break-even win rate ${s.avgWinPct - s.avgLossPct > 0 ? pct(-s.avgLossPct / (s.avgWinPct - s.avgLossPct), 0) : "—"}` : "of the money put on each trade"}
        />
        <Stat
          label="Per trade"
          value={s.closed ? signedUsd(s.expectancy, 0) : "—"}
          sub={s.closed < 20 ? `${Math.max(0, 20 - s.closed)} more closed trades before this means much` : `average dollars per closed ${what}`}
          tone={s.closed ? (s.expectancy > 0 ? "up" : "down") : undefined}
        />
      </StatStrip>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel className="min-w-0">
          <PanelHeader title="Paper trades" sub="Entry at the ask when made; exits by target, stop, thesis or time" right={<Badge tone="mute">{s.n} total</Badge>} />
          {shown.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <div className="text-[15px] font-semibold">No paper trades yet</div>
              <p className="mx-auto mt-1.5 max-w-[56ch] text-[13px] leading-relaxed text-muted">
                {group === "go" ? (
                  <>
                    The first time a contract in{" "}
                    <Link href="/watch" className="text-fg underline underline-offset-4">
                      Watch
                    </Link>{" "}
                    turns Go, or a signal alert goes out as BUY NOW, it is bought here at your plan&apos;s size and tracked to its exit.
                  </>
                ) : (
                  <>
                    The next picks (9:45 ET on a trading day, or{" "}
                    <Link href="/plan" className="text-fg underline underline-offset-4">
                      build them now
                    </Link>
                    ) are bought here automatically and tracked to their exit.
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[900px] whitespace-nowrap text-right text-[12.5px]">
                <thead>
                  <tr className="cap [&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-5 [&>th]:font-medium">
                    <th className="text-left">Made</th>
                    <th className="text-left">From</th>
                    <th className="text-left">Contract</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Now / exit</th>
                    <th>P/L</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className="border-b border-line last:border-0 [&>td]:h-11 [&>td]:px-5">
                      <td className="text-left text-muted">{shortDate(t.day)}</td>
                      <td className="text-left">
                        {t.source === "go" ? (
                          <Badge tone="accent" title={t.entryTag ? `Entry timing was "${t.entryTag}" when it fired` : undefined}>
                            Go {t.score ?? ""}
                          </Badge>
                        ) : (
                          <Badge tone="mute">Pick</Badge>
                        )}
                        {t.lane === "lottery" && (
                          <Badge tone="warn" className="ml-1.5">
                            Lottery
                          </Badge>
                        )}
                      </td>
                      <td className="text-left">
                        <Link href={`/s/${t.symbol}`} className="font-semibold hover:underline">
                          {t.symbol}
                        </Link>{" "}
                        <span className={t.type === "call" ? "text-up" : "text-down"}>{contractLabel(t)}</span>
                      </td>
                      <td>{t.qty}</td>
                      <td>{t.entry.toFixed(2)}</td>
                      <td>{(t.status === "closed" ? (t.exit ?? 0) : (t.mark ?? t.entry)).toFixed(2)}</td>
                      <td className={clsx("font-semibold", tone(t.pnl))}>
                        {signedUsd(t.pnl, 0)} <span className="font-normal">({signedPct(t.pnlPct, 0)})</span>
                      </td>
                      <td className="text-left">
                        {t.status === "open" ? (
                          <Badge tone="accent">
                            Open · target {t.target.toFixed(2)} · stop {t.stop.toFixed(2)}
                          </Badge>
                        ) : (
                          <Badge tone={t.exitReason === "target" ? "up" : t.exitReason === "stop" || t.exitReason === "thesis" ? "down" : "mute"}>{REASON[t.exitReason ?? "time"]}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Paper equity" sub="Cumulative closed P/L" />
          <div className="h-56 px-2 pb-2 pt-4">
            {curve.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curve} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--c-line)" />
                  <XAxis dataKey="day" tickFormatter={(d) => shortDate(String(d))} tick={tick} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis width={52} tickFormatter={(v) => usd(Number(v), 0)} tick={tick} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--c-raised)", border: "1px solid var(--c-line-strong)", borderRadius: 12, fontSize: 12 }}
                    labelFormatter={(d) => shortDate(String(d))}
                    formatter={(v) => [signedUsd(Number(v), 0), "Cumulative"]}
                  />
                  <ReferenceLine y={0} stroke="var(--c-line-strong)" />
                  <Area dataKey="cum" stroke="var(--c-fg)" strokeWidth={2} fill="var(--c-fg)" fillOpacity={0.06} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center px-6 text-center text-[12.5px] leading-relaxed text-muted">The curve appears after paper trades have closed on two different days.</div>
            )}
          </div>
          <p className="border-t border-line px-5 py-3 text-[11.5px] leading-relaxed text-faint">
            Prices are sampled once a minute while Strike is running. Until there are a few dozen closed trades, a good or bad run here is mostly luck.
          </p>
        </Panel>
      </div>

      {presets.length > 0 && <GoalOdds start={plan.equity} goal={plan.settings.goal} days={plan.tradingDaysLeft} presets={presets} />}
    </Page>
  );
}
