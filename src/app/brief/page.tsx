"use client";

import clsx from "clsx";
import Link from "next/link";
import { ContextPanel } from "@/components/ContextPanel";
import { Check, X } from "lucide-react";
import { Badge, Button, Page, PageError, PageHeader, PageSkeleton, Panel, PanelHeader, Stat, StatStrip } from "@/components/ui";
import type { Brief } from "@/lib/desk";
import type { FocusItem } from "@/lib/focus";
import type { GapRead } from "@/lib/gap";
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

const STATE: Record<GapRead["state"], { label: string; tone: "up" | "down" | "warn" | "mute" | "accent" }> = {
  none: { label: "No gap", tone: "mute" },
  "pre-market": { label: "Pre-market", tone: "accent" },
  extending: { label: "Extending", tone: "up" },
  holding: { label: "Holding", tone: "up" },
  fading: { label: "Fading", tone: "warn" },
  filled: { label: "Filled", tone: "down" },
};

const LEAN = {
  bullish: { label: "Leans bullish", tone: "up", edge: "edge-up" },
  bearish: { label: "Leans bearish", tone: "down", edge: "edge-down" },
  "two-way": { label: "Two-way", tone: "warn", edge: "edge-warn" },
} as const;
const VOTE = { 1: "bg-up", 0: "bg-line-strong", "-1": "bg-down" } as const;
const STATUS_BG = { up: "bg-up/10", down: "bg-down/10", warn: "bg-warn/10", neutral: "bg-raised/60" } as const;
const STATUS_TEXT = { up: "text-up", down: "text-down", warn: "text-warn", neutral: "text-fg" } as const;

/** The names most likely to make an outsized move today, with the evidence and the levels that confirm or break it. */
function Focus({ items }: { items: FocusItem[] }) {
  return (
    <Panel>
      <PanelHeader
        title="Ones to watch"
        sub="Most likely to move big today, which way the evidence leans, and whether the move is holding"
        right={
          <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
            <span className="pulse-dot size-1.5 rounded-full bg-up" /> live
          </span>
        }
      />
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] leading-relaxed text-muted">
          Nothing stands out yet: no large gaps, earnings or one-sided flow. This fills in as pre-market trading builds.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((f) => {
            const l = LEAN[f.lean];
            const side = f.lean === "bearish" ? "put" : "call";
            return (
              <li key={f.symbol} className={clsx("edge px-5 py-4", l.edge)}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Link href={`/s/${f.symbol}`} className="text-[16px] font-semibold tracking-[-0.02em] hover:underline">
                    {f.symbol}
                  </Link>
                  <Badge tone={l.tone}>{l.label}</Badge>
                  {f.lean !== "two-way" && <Badge tone={f.confidence === "Strong" ? "up" : "mute"}>{f.confidence}</Badge>}
                  {f.held && <Badge tone="accent">You hold {f.held.label}</Badge>}
                  {f.catalyst && <Badge tone="warn">Earnings</Badge>}
                  <span className="num text-[13px]">
                    {usd(f.price)} <span className={f.changePct >= 0 ? "text-up" : "text-down"}>{signedPct(f.changePct)}</span>
                  </span>
                  {f.gap && Math.abs(f.gap.gapAtr) >= 0.3 && (
                    <span className="num text-[12px] text-faint">
                      gapped {signedPct(f.gap.gapPct)} ({Math.abs(f.gap.gapAtr).toFixed(1)}× a normal day)
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 text-[12px] text-faint" title="How likely an outsized move is today, 0-100">
                    move
                    <span className="h-1 w-14 overflow-hidden rounded-full bg-line-strong">
                      <span className="block h-full rounded-full bg-fg" style={{ width: `${f.move}%` }} />
                    </span>
                    <span className="num font-semibold text-fg">{f.move}</span>
                  </span>
                </div>

                <div className={clsx("mt-3 rounded-xl px-3.5 py-3", f.grade === "A" ? "bg-up/12" : f.grade === "B" ? "bg-accent/12" : "bg-raised/60")}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span
                      className={clsx(
                        "grid size-7 shrink-0 place-items-center rounded-lg text-[14px] font-bold",
                        f.grade === "A" ? "bg-up text-black" : f.grade === "B" ? "bg-accent text-white" : "bg-line-strong text-muted",
                      )}
                      title="A: full size. B: half size. C: watch only."
                    >
                      {f.grade}
                    </span>
                    <span className={clsx("text-[14px] font-semibold tracking-[-0.01em]", f.grade === "A" ? "text-up" : f.grade === "B" ? "text-accent" : "text-fg")}>
                      {f.grade === "A"
                        ? "A setup: full plan size, after it passes Watch"
                        : f.grade === "B"
                          ? "B setup: half size, after it passes Watch"
                          : f.held
                            ? "Would not be a new buy right now"
                            : "Not a trade right now: do not buy"}
                    </span>
                    <span className="num ml-auto text-[12px] text-muted">
                      required {f.gate.filter((c) => c.kind === "required" && c.ok).length}/{f.gate.filter((c) => c.kind === "required").length} · confluence{" "}
                      {f.gate.filter((c) => c.kind === "confluence" && c.ok).length}/{f.gate.filter((c) => c.kind === "confluence").length}
                    </span>
                  </div>
                  <div className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {(["required", "confluence"] as const).map((kind) => {
                      const rows = f.gate.filter((c) => c.kind === kind);
                      if (!rows.length) return null;
                      return (
                        <div key={kind}>
                          <div className="mb-1 text-[11px] font-medium text-faint">{kind === "required" ? "Required: all of these" : "Confluence: sets the size"}</div>
                          <ul className="space-y-1">
                            {rows.map((c) => (
                              <li key={c.label} title={c.note} className="flex items-start gap-2 text-[12px] leading-snug">
                                <span className={clsx("mt-px grid size-4 shrink-0 place-items-center rounded-full", c.ok ? "bg-up/20 text-up" : kind === "required" ? "bg-down/20 text-down" : "bg-line-strong text-muted")}>
                                  {c.ok ? <Check size={10} strokeWidth={3.5} /> : <X size={10} strokeWidth={3.5} />}
                                </span>
                                <span className="min-w-0">
                                  <span className={c.ok ? "text-muted" : "font-medium text-fg"}>{c.label}</span>
                                  {!c.ok && <span className="block text-[11.5px] text-faint">{c.note}</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={clsx("mt-2 rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed", STATUS_BG[f.live.tone])}>
                  <span className={clsx("font-semibold", STATUS_TEXT[f.live.tone])}>{f.live.status}.</span> <span className="text-fg/90">{f.live.note}</span>
                  {f.held && <span className="font-medium text-fg"> {f.held.verdict}</span>}
                  {(f.live.used !== undefined || f.live.rsi !== undefined) && (
                    <span className="num mt-1 block text-[11.5px] text-muted">
                      {f.live.dayLow !== undefined && f.live.dayHigh !== undefined && `Today ${usd(f.live.dayLow)} – ${usd(f.live.dayHigh)}`}
                      {f.live.used !== undefined && ` · ${Math.round(f.live.used * 100)}% of a normal day used`}
                      {f.live.vsVwap !== undefined && ` · ${signedPct(f.live.vsVwap)} vs average price`}
                      {f.live.rsi !== undefined && ` · RSI ${f.live.rsi.toFixed(0)}`}
                    </span>
                  )}
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {f.votes.map((v) => (
                    <span key={v.source} title={v.note} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-raised px-2.5 text-[11.5px] text-muted">
                      <span className={clsx("size-1.5 rounded-full", VOTE[v.vote])} />
                      {v.source}
                    </span>
                  ))}
                </div>

                <ul className="mt-2.5 space-y-1 text-[12.5px] leading-snug text-muted">
                  {f.reasons.slice(0, 4).map((r) => (
                    <li key={r} className="flex gap-2.5">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
                      <span className="min-w-0">{r}</span>
                    </li>
                  ))}
                </ul>

                {f.reach && (f.reach.up || f.reach.down) && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(["up", "down"] as const).map((k) => {
                      const r = f.reach?.[k];
                      if (!r) return null;
                      const upSide = k === "up";
                      return (
                        <div key={k} className="rounded-xl bg-raised/60 px-3.5 py-2.5">
                          <div className="text-[11.5px] text-faint">
                            {upSide ? "Upside stretch levels: not targets" : "Downside stretch levels: not targets"}
                            {r.passed && " (a normal day is already covered)"}
                          </div>
                          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                            <span className="num text-[13.5px]">
                              <span className={clsx("font-semibold", upSide ? "text-up" : "text-down")}>{usd(r.normal)}</span>{" "}
                              <span className="text-[11.5px] text-muted">
                                {r.normalOdds !== undefined ? `${Math.round(r.normalOdds * 100)}% chance today` : "normal day"}
                                {r.normalOdds !== undefined && r.normalOdds < 0.5 ? " (unlikely)" : ""}
                              </span>
                            </span>
                            <span className="num text-[13.5px]">
                              <span className={clsx("font-semibold", upSide ? "text-up" : "text-down")}>{usd(r.big)}</span>{" "}
                              <span className="text-[11.5px] text-muted">{r.bigOdds !== undefined ? `${Math.round(r.bigOdds * 100)}% chance today` : "big day"}</span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]">
                  {f.levels.confirm && (
                    <span>
                      <span className="font-medium text-up">Right if</span> <span className="text-muted">{f.levels.confirm}</span>
                    </span>
                  )}
                  {f.levels.wrong && (
                    <span>
                      <span className="font-medium text-down">Wrong if</span> <span className="text-muted">{f.levels.wrong}</span>
                    </span>
                  )}
                  <Link href={`/watch?sym=${f.symbol}&side=${side}${f.size > 0 ? `&size=${f.size}` : ""}`} className="ml-auto">
                    <Button variant={f.ready ? "primary" : "ghost"}>{f.ready ? "Check it in Watch" : "Look at it in Watch"}</Button>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line px-5 py-3 text-[11.5px] leading-relaxed text-faint">
        A lean is not a trade. Four conditions are required: price has confirmed, the move is not extended, the market is not against it, and it is inside the
        9:45–3:00 window. Five more are confluence: the full analysis, option flow in size for that stock, its gap history, no reversal warning, and beating the
        index. Required plus four or five is an A setup at full size; plus two or three is a B at half size; anything else is watch only. Ranked by how likely an outsized move is (gap size, pre-market volume, earnings, headlines, option flow), not by how sure the direction is. Each dot is one
        source: green bullish, red bearish, grey no view. Strong means three or more agree and none disagree. “Normal day” is a full normal day&apos;s range (ATR) measured
        from today&apos;s low (up) or high (down), “big day” one and a half; the odds are the options market&apos;s chance of the price touching that level before the close. Rumours count only once they are reported in headlines.
        The status line and levels refresh every 20 seconds from live prices; which names are listed and their votes refresh every 3 minutes. Stocks you hold
        are always listed and judged in the direction of your position. None of this is a buy on its own: put the trade through Watch after 9:45.
      </p>
    </Panel>
  );
}

/** How each name opened against yesterday's close, and this stock's record with similar gaps. */
function Gaps({ gaps, pre }: { gaps: GapRead[]; pre: boolean }) {
  return (
    <Panel className="min-w-0">
      <PanelHeader
        title={pre ? "Pre-market gaps" : "Gaps at the open"}
        sub={pre ? "From pre-market trades: a lean until the stock shows what it does after 9:30" : "From the regular open: what each stock is doing with its gap"}
      />
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[720px] whitespace-nowrap text-right text-[12.5px]">
          <thead>
            <tr className="cap [&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-5 [&>th]:font-medium">
              <th className="text-left">Symbol</th>
              <th>Gap</th>
              <th title="Size of the gap in normal days (ATR)">× normal day</th>
              <th>{pre ? "Pre-market volume" : "Given back"}</th>
              <th className="text-left">State</th>
              <th className="text-left" title="Gaps in the same direction and of similar size over the last six months">Past similar gaps</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => {
              const st = STATE[g.state];
              return (
                <tr key={g.symbol} className="border-b border-line last:border-0 [&>td]:h-11 [&>td]:px-5">
                  <td className="text-left">
                    <Link href={`/s/${g.symbol}`} className="font-semibold hover:underline">
                      {g.symbol}
                    </Link>
                  </td>
                  <td className={g.gapPct >= 0 ? "text-up" : "text-down"}>{signedPct(g.gapPct)}</td>
                  <td className={Math.abs(g.gapAtr) >= 1 ? "font-semibold" : "text-muted"}>{Math.abs(g.gapAtr).toFixed(1)}×</td>
                  <td className="text-muted">
                    {pre
                      ? g.pre?.volShare !== undefined
                        ? `${(g.pre.volShare * 100).toFixed(1)}% of a day`
                        : "—"
                      : g.fill !== undefined
                        ? `${Math.round(Math.max(-1, Math.min(2, g.fill)) * 100)}%`
                        : "—"}
                  </td>
                  <td className="text-left">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {g.range && g.range.side !== "inside" && <span className="ml-2 font-sans text-[11.5px] text-faint">{g.range.side} opening range</span>}
                  </td>
                  <td className="text-left text-muted">
                    {g.history ? (
                      <>
                        <span className="text-fg">{g.history.continued}</span> of {g.history.n} kept going, <span className="text-fg">{g.history.filled}</span> filled
                      </>
                    ) : (
                      <span className="text-faint">too few to count</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-3 text-[11.5px] leading-relaxed text-faint">
        A gap is measured in normal days (ATR). “Filled” means the stock is back through yesterday&apos;s close: a failed gap, often a reversal. The record counts this
        stock&apos;s gaps in the same direction and of similar size over about six months; “kept going” means it closed beyond its open that day.
      </p>
    </Panel>
  );
}

export default function BriefPage() {
  const { data, error } = usePoll<Brief>("/api/brief", 10_000);
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

          {(b.phase === "pre" || b.phase === "open") && <Focus items={b.focus ?? []} />}

          {b.gaps.length > 0 && <Gaps gaps={b.gaps} pre={b.phase === "pre"} />}

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
