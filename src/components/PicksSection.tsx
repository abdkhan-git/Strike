"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Tick } from "@/components/Tick";
import { toast } from "@/components/Toaster";
import { TradeInstruction } from "@/components/TradeInstruction";
import { Badge, Bullets, Button, Meter, Panel, PanelHeader, ticketHref } from "@/components/ui";
import { contractLabel, dateLabel, pct, shortDate, signedPct, usd } from "@/lib/format";
import { buyInstruction } from "@/lib/instruction";
import { etDay } from "@/lib/session";
import type { Briefing, Checkpoint, Enriched, Horizon, TrackBucket, TrackView, Verdict } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

type PicksData = {
  briefing?: Briefing;
  live: Record<string, { mark: number; ret: number; spot: number; verdict?: Verdict; contract?: Enriched }>;
  track: TrackView;
};

const HORIZON: Record<Horizon, string> = { eod: "Today", week: "This week", month: "1 month", quarter: "2 months" };
const CP: { key: Checkpoint; label: string }[] = [
  { key: "h1", label: "1 hour" },
  { key: "close", label: "Same-day close" },
  { key: "d1", label: "Next day" },
  { key: "expiry", label: "Expiry" },
];
const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");

/** What the live call means for someone deciding whether to buy the pick. */
function liveCall(v: Verdict): { text: string; tone: "up" | "down" | "warn" } {
  if (v.move === "keep") return v.quality === "bad" ? { text: "Weakening: skip it if you haven't bought", tone: "warn" } : { text: "Still valid: OK to buy at the limit", tone: "up" };
  return v.quality === "bad" ? { text: "Broken: don't buy; sell if you hold it", tone: "down" } : { text: "Already moved: if you hold it, take the gain", tone: "warn" };
}

/** Today's picks (with live calls), the re-rank button and the track record. Rendered on the Plan page. */
export function PicksSection({ paused, needToday }: { paused?: boolean; needToday?: number }) {
  const { data, error, reload } = usePoll<PicksData>("/api/picks", 10_000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/picks?action=run", { method: "POST" });
      if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "Could not build picks");
      else toast("Picks re-ranked with the latest data", "up");
    } catch {
      setErr("Could not reach the server");
    } finally {
      setBusy(false);
      reload();
    }
  }

  if (!data) return <Panel className="px-5 py-10 text-center text-muted">{error ? <span className="text-down">{error}</span> : "Loading picks…"}</Panel>;

  const b = data.briefing;
  const isToday = b?.day === etDay();
  const total = b?.picks.reduce((s, p) => s + p.cost, 0) ?? 0;
  const need = b?.needToday ?? needToday;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.03em]">Today&apos;s picks</h2>
          <p className="mt-1 text-[13px] text-muted">
            {b
              ? `${isToday ? "Built" : `From ${dateLabel(b.day)}, built`} ${new Date(b.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${usd(b.budget, 0)} a trade${
                  b.picks.length > 1 ? ` · ${usd(total, 0)} for all ${b.picks.length}` : ""
                }${b.cash !== undefined ? ` · ${usd(b.cash, 0)} cash` : ""}`
              : "Built automatically at 9:45 ET on trading days, then re-ranked every 30 minutes."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {err && <span className="text-[12.5px] text-down">{err}</span>}
          <Button variant={isToday ? "default" : "primary"} onClick={run} disabled={busy}>
            <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
            {busy ? "Ranking setups…" : isToday ? "Re-rank now" : "Build today's picks"}
          </Button>
        </div>
      </div>

      {b && !isToday && (
        <p className="rounded-2xl bg-warn/10 px-4 py-3 text-[13px] text-warn">These picks are from an earlier day. Prices and the case for each have moved; build today&apos;s before acting.</p>
      )}
      {b?.paused && (
        <p className="rounded-2xl bg-warn/10 px-4 py-3 text-[13px] text-warn">
          Plan paused: your daily loss limit or position slots say no new trades. These are listed for watching and for tomorrow.
        </p>
      )}

      {!b ? (
        <Panel className="px-5 py-12 text-center text-muted">No picks yet. Press the button to build them now.</Panel>
      ) : b.picks.length === 0 ? (
        <Panel className="px-6 py-10 text-center">
          <div className="text-[16px] font-semibold tracking-[-0.02em]">No trade today</div>
          <p className="mx-auto mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-muted">{b.passed ?? "No setup passed the filters."}</p>
        </Panel>
      ) : (
        b.picks.map((p) => {
          const up = p.direction === "bullish";
          const Arrow = up ? ArrowUpRight : ArrowDownRight;
          const live = data.live[p.symbol];
          const entry = p.contract.ask || p.contract.mid;
          const call = live?.verdict ? liveCall(live.verdict) : undefined;
          const ins = buyInstruction(live?.contract ?? p.contract, { budget: b.budget, horizon: p.horizon });
          const share = need && need > 0 ? ins.targetGain / need : undefined;
          return (
            <Panel key={p.symbol} tone={up ? "up" : "down"}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pt-5">
                <span className="num grid size-7 place-items-center rounded-full bg-raised text-[12px] font-semibold text-muted">{p.rank}</span>
                <Link href={`/s/${p.symbol}`} className="text-[22px] font-semibold leading-none tracking-[-0.03em] hover:underline">
                  {p.symbol}
                </Link>
                <span className={clsx("flex items-center gap-0.5 text-[13.5px] font-medium", up ? "text-up" : "text-down")}>
                  <Arrow size={16} strokeWidth={2.2} />
                  {up ? "Bullish" : "Bearish"}
                </span>
                <Badge tone="mute">{HORIZON[p.horizon]}</Badge>
                <span className="flex items-center gap-2 text-[12px] text-faint">
                  conviction <Meter value={p.score} tone={up ? "up" : "down"} />
                </span>
                <div className="ml-auto flex items-center gap-4">
                  {live ? (
                    <div className="text-right">
                      <div className="text-[11.5px] text-faint">Since picked</div>
                      <Tick value={live.mark} className={clsx("num text-[18px] font-semibold leading-tight", tone(live.ret))}>
                        {signedPct(live.ret, 0)}
                      </Tick>
                      <div className="num text-[11.5px] text-muted">
                        {usd(entry)} → {usd(live.mark)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-[12px] text-faint">No live quote</span>
                  )}
                  <Link href={ticketHref(p.contract)}>
                    <Button>Open ticket</Button>
                  </Link>
                </div>
              </div>

              <div className="space-y-4 px-6 pb-5 pt-4">
                {call && live?.verdict && (
                  <div className={clsx("rounded-xl px-4 py-2.5 text-[13px]", call.tone === "up" ? "bg-up/10" : call.tone === "down" ? "bg-down/10" : "bg-warn/10")}>
                    <span className={clsx("font-semibold", call.tone === "up" ? "text-up" : call.tone === "down" ? "text-down" : "text-warn")}>{call.text}</span>
                    <span className="ml-2 text-muted">{live.verdict.headline}</span>
                  </div>
                )}

                <TradeInstruction c={live?.contract ?? p.contract} horizon={p.horizon} budget={b.budget} paused={b.paused || paused} />

                {share !== undefined && (
                  <div>
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="text-muted">
                        Hitting the target makes <span className="num text-up">+{usd(ins.targetGain, 0)}</span>, {pct(Math.min(share, 9.99), 0)} of what the goal asks of today (
                        {usd(need!, 0)})
                      </span>
                      <span className="num text-faint">stop costs −{usd(ins.maxLoss, 0)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-strong">
                      <div className="h-full rounded-full bg-up transition-[width] duration-500" style={{ width: `${Math.min(1, share) * 100}%` }} />
                    </div>
                  </div>
                )}

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <div>
                    <div className="text-[12px] font-medium text-muted">
                      The case
                      <span className="font-normal text-faint">
                        {p.decidedBy ? ` · chosen by ${p.decidedBy}` : ""}
                        {p.analysisScore !== undefined && ` · analysis ${p.analysisScore > 0 ? "+" : ""}${p.analysisScore}/100`}
                      </span>
                    </div>
                    {p.thesis && <p className="mt-1.5 text-[13.5px] leading-relaxed">{p.thesis}</p>}
                    {p.invalidation !== undefined && (
                      <p className="mt-2.5 text-[13px]">
                        <span className="font-semibold text-down">
                          Wrong if {p.symbol} {up ? "falls below" : "rises above"} {usd(p.invalidation)}
                        </span>
                        {p.invalidationReason && <span className="text-muted">: {p.invalidationReason}</span>}
                      </p>
                    )}
                    <p className="mt-2.5 text-[12.5px] text-muted">
                      {contractLabel(p.contract)} · expires {dateLabel(p.contract.expiration)} · <span className="num text-fg">{pct(p.contract.pop, 0)}</span> implied odds the stock is
                      past break-even at expiry
                    </p>
                  </div>
                  <div className="space-y-4">
                    {!!p.risks?.length && (
                      <div>
                        <div className="mb-1.5 text-[12px] font-medium text-muted">What could break it</div>
                        <Bullets items={p.risks} dot="bg-warn" />
                      </div>
                    )}
                    <details className="group">
                      <summary className="cursor-pointer list-none text-[12px] font-medium text-muted transition-colors hover:text-fg">
                        Every factor <span className="text-faint group-open:hidden">· show</span>
                      </summary>
                      <Bullets items={p.reasons} className="mt-2 !text-[12px]" />
                    </details>
                  </div>
                </div>
              </div>
            </Panel>
          );
        })
      )}

      {b && b.picks.length > 0 && (b.passed || b.notes.length > 0) && (
        <Panel className="space-y-2 px-6 py-4 text-[12.5px] leading-relaxed text-muted">
          {b.passed && (
            <p>
              <span className="font-medium text-fg">Passed over.</span> {b.passed}
            </p>
          )}
          {b.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Panel>
      )}
      {b && b.picks.length === 0 && b.notes.length > 0 && (
        <Panel className="space-y-2 px-6 py-4 text-[12.5px] leading-relaxed text-muted">
          {b.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Panel>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <TrackTable title="Track record: picks" buckets={data.track.picks} empty="Picks are scored 1 hour after they are made, at the close, the next day and at expiry." />
        <TrackTable
          title="Track record: signals 70+"
          buckets={data.track.signals}
          empty="Every signal at conviction 70 or higher is recorded and scored the same way, so you can see which levels pay."
        />
      </div>

      {data.track.recent.length > 0 && (
        <Panel className="min-w-0">
          <PanelHeader title="Past picks" />
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[900px] whitespace-nowrap text-right text-[12.5px]">
              <thead>
                <tr className="cap [&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-5 [&>th]:font-medium">
                  <th className="text-left">Day</th>
                  <th className="text-left">Pick</th>
                  <th>Score</th>
                  <th>Entry</th>
                  {CP.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th>Best</th>
                </tr>
              </thead>
              <tbody>
                {data.track.recent.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 [&>td]:h-10 [&>td]:px-5">
                    <td className="text-left text-muted">{shortDate(r.day)}</td>
                    <td className="text-left">
                      <span className="font-semibold">{r.symbol}</span> <span className={r.type === "call" ? "text-up" : "text-down"}>{contractLabel(r)}</span>
                    </td>
                    <td className="text-muted">{r.score ?? "—"}</td>
                    <td>{usd(r.entry)}</td>
                    {CP.map((c) => {
                      const m = r.marks[c.key];
                      return (
                        <td key={c.key} className={m ? tone(m.ret) : "text-faint"}>
                          {m ? signedPct(m.ret, 0) : "pending"}
                        </td>
                      );
                    })}
                    <td className={r.peak ? tone(r.peak.ret) : "text-faint"}>{r.peak ? signedPct(r.peak.ret, 0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function TrackTable({ title, buckets, empty }: { title: string; buckets: TrackBucket[]; empty: string }) {
  return (
    <Panel className="min-w-0">
      <PanelHeader title={title} />
      {!buckets.length ? (
        <p className="px-5 py-10 text-center text-[12.5px] text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[640px] whitespace-nowrap text-right text-[12.5px]">
            <thead>
              <tr className="cap [&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-4 [&>th]:font-medium">
                <th className="text-left">Group</th>
                <th>N</th>
                {CP.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th title="Share that reached +100% at some point">Hit +100%</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.label} className="border-b border-line last:border-0 [&>td]:h-10 [&>td]:px-4">
                  <td className="text-left text-muted">{b.label}</td>
                  <td className="text-faint">{b.n}</td>
                  {CP.map((c) => {
                    const x = b.at[c.key];
                    return (
                      <td key={c.key} title={x ? `${x.n} scored, ${pct(x.win, 0)} in profit` : undefined}>
                        {x ? (
                          <>
                            <span className={tone(x.avg)}>{signedPct(x.avg, 0)}</span> <span className="text-faint">{pct(x.win, 0)}</span>
                          </>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td>{pct(b.hit100, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-faint">
            Each cell: average return, then share in profit. Returns are on the contract&apos;s price from the ask when recorded.
          </p>
        </div>
      )}
    </Panel>
  );
}
