"use client";

import clsx from "clsx";
import Link from "next/link";
import { ContextPanel } from "@/components/ContextPanel";
import { Badge, Button, Page, PageError, PageHeader, PageSkeleton, Panel, PanelHeader, Stat, StatStrip } from "@/components/ui";
import type { Brief } from "@/lib/desk";
import { signedPct, signedUsd, usd } from "@/lib/format";
import { usePoll } from "@/lib/usePoll";

const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");
const PHASE: Record<Brief["phase"], { label: string; sub: string }> = {
  pre: { label: "Pre-market", sub: "What the day looks like and what your rules allow, before anything is bought." },
  open: { label: "Session", sub: "Where things stand right now, and what needs doing." },
  post: { label: "Round-up", sub: "What happened against the plan today, and what carries into the next session." },
  closed: { label: "Market closed", sub: "Where you stand, and what to expect at the next open." },
};
const CALL_TONE = { up: "text-up", down: "text-down", warn: "text-warn", neutral: "text-fg" } as const;

export default function BriefPage() {
  const { data, error } = usePoll<Brief>("/api/brief", 20_000);
  if (!data) return error ? <PageError message={error} /> : <PageSkeleton label="Writing the brief…" />;

  const b = data;
  const ph = PHASE[b.phase];
  const post = b.phase === "post";

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <Badge tone={b.phase === "open" ? "up" : "mute"}>{ph.label}</Badge>
            <span>updated {new Date(b.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
          </>
        }
        title={b.title.split(" · ").slice(-1)[0]}
        subtitle={ph.sub}
      />

      <StatStrip>
        <Stat
          label={post ? "Realized today" : "Size for the next trade"}
          value={post ? signedUsd(b.result?.pnl ?? 0, 0) : b.plan.halted ? "Paused" : usd(b.plan.budget, 0)}
          sub={post ? (b.result ? `${b.result.trades} closed, ${b.result.wins} won` : "no trades closed") : b.plan.halted ? "daily loss limit reached" : `${b.plan.style} style`}
          tone={post ? ((b.result?.pnl ?? 0) > 0 ? "up" : (b.result?.pnl ?? 0) < 0 ? "down" : undefined) : b.plan.halted ? "down" : undefined}
        />
        <Stat label="The goal's pace today" value={signedUsd(b.plan.needToday, 0)} sub={`made so far ${signedUsd(b.plan.todayPnl, 0)}`} />
        <Stat label="Account" value={usd(b.plan.equity, 0)} sub={b.plan.todayOpenPnl ? `${signedUsd(b.plan.todayOpenPnl, 0)} open on today's trades` : "live value"} />
        <Stat
          label="Open positions"
          value={String(b.positions.length)}
          sub={b.positions.some((p) => p.needsAction) ? `${b.positions.filter((p) => p.needsAction).length} need action` : b.positions.length ? "none need action" : "nothing carried"}
          tone={b.positions.some((p) => p.needsAction) ? "down" : undefined}
        />
      </StatStrip>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title={post ? "The day in a few lines" : "What matters"} />
            <ul className="space-y-3 px-5 py-5">
              {b.lines.map((l) => (
                <li key={l} className="flex gap-3 text-[14px] leading-relaxed">
                  <span className="mt-[10px] size-1 shrink-0 rounded-full bg-fg" />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title={post ? "Next session" : "Game plan"} sub={post ? b.nextSession : "In order, by the clock (ET)"} />
            <ol className="divide-y divide-line">
              {b.checklist.map((c, i) => (
                <li key={i} className="grid grid-cols-[92px_minmax(0,1fr)] gap-4 px-5 py-3.5 text-[13.5px] leading-relaxed">
                  <span className="num font-semibold text-muted">{c.when}</span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel>
            <PanelHeader
              title="Open positions"
              right={
                <Link href="/positions">
                  <Button variant="ghost">Open Positions</Button>
                </Link>
              }
            />
            {b.positions.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted">Nothing open. Nothing to manage at the open.</p>
            ) : (
              <ul className="divide-y divide-line">
                {b.positions.map((p) => (
                  <li key={p.id} className={clsx("edge px-5 py-4", p.tone === "up" ? "edge-up" : p.tone === "down" ? "edge-down" : p.tone === "warn" ? "edge-warn" : "edge-mute")}>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-[14px] font-semibold">
                        {p.label} <span className="num font-normal text-muted">×{p.qty}</span>
                      </span>
                      <span className={clsx("num text-[13px] font-medium", tone(p.pnl))}>
                        {signedUsd(p.pnl, 0)} ({signedPct(p.pnlPct, 0)})
                      </span>
                      {p.call && <span className={clsx("text-[13px] font-medium", CALL_TONE[p.tone ?? "neutral"])}>{p.call}</span>}
                      {p.sellBy && <span className="ml-auto text-[12px] text-faint">out by {p.sellBy}</span>}
                    </div>
                    {p.doNow && <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{p.doNow}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title={b.picks.length && b.picks[0].day === b.day ? "Today's picks" : "Latest picks"}
              sub="Followed on paper by the exact exit rules"
              right={
                <Link href="/plan">
                  <Button variant="ghost">Open Plan</Button>
                </Link>
              }
            />
            {b.picks.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted">No picks yet. They are built at 9:45 ET on trading days.</p>
            ) : (
              <ul className="divide-y divide-line">
                {b.picks.map((p) => (
                  <li key={p.label} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                    <Link href={`/s/${p.symbol}`} className="text-[14px] font-semibold hover:underline">
                      {p.symbol} <span className={p.type === "call" ? "text-up" : "text-down"}>{p.label.slice(p.symbol.length + 1)}</span>
                    </Link>
                    <span className="num text-[12.5px] text-muted">entry {p.entry.toFixed(2)}</span>
                    <Badge tone={p.status === "hit its target" ? "up" : p.status === "stopped out" || p.status === "thesis broke" ? "down" : "mute"}>{p.status}</Badge>
                    {p.held && <Badge tone="accent">You hold this</Badge>}
                    {p.pnl !== undefined && (
                      <span className={clsx("num ml-auto text-[13px] font-semibold", tone(p.pnl))}>
                        {signedUsd(p.pnl, 0)} <span className="font-normal">({signedPct(p.pnlPct ?? 0, 0)})</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <ContextPanel ctx={b.context} />
          <Panel>
            <PanelHeader title="Biggest moves" sub={post ? "Today, against the prior close" : "Against the last close"} />
            <ul className="grid grid-cols-2 gap-px bg-line">
              {b.movers.map((m) => (
                <li key={m.symbol} className="bg-panel">
                  <Link href={`/s/${m.symbol}`} className="flex items-baseline justify-between gap-2 px-5 py-3 transition-colors hover:bg-hover">
                    <span className="text-[13px] font-semibold">{m.symbol}</span>
                    <span className={clsx("num text-[13px]", m.changePct >= 0 ? "text-up" : "text-down")}>{signedPct(m.changePct, 1)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel className="px-5 py-4">
            <div className="text-[12px] font-medium text-muted">On your phone</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
              The pre-market brief is pushed at 9:00 ET and the round-up at 4:05 pm ET on trading days, while Strike is running. Turn them off under the bell.
            </p>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
