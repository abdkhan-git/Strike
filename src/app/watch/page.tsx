"use client";

import clsx from "clsx";
import { Check, Minus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ContextPanel } from "@/components/ContextPanel";
import { LogTradeDialog, type Loggable } from "@/components/LogTradeDialog";
import { toast } from "@/components/Toaster";
import { Badge, Button, Change, Chip, Page, PageError, PageHeader, PageSkeleton, Panel, PanelHeader, Ring, Segmented, fieldClass, ticketHref } from "@/components/ui";
import type { IdeaCheck, MarketContext } from "@/lib/desk";
import { contractLabel, pct, shortDate, signedPct, strikeLabel, usd } from "@/lib/format";
import type { OptType, PlanView, SymbolView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

type WatchData = { checks: IdeaCheck[]; context?: MarketContext };

const VERDICT: Record<IdeaCheck["verdict"], { label: string; tone: "up" | "down" | "warn" | "neutral" }> = {
  go: { label: "Go", tone: "up" },
  wait: { label: "Wait", tone: "warn" },
  skip: { label: "Skip", tone: "down" },
  closed: { label: "Market closed", tone: "neutral" },
  unknown: { label: "No read", tone: "neutral" },
};

export default function WatchPage() {
  const { data, error, reload } = usePoll<WatchData>("/api/watch", 5000);
  const [logging, setLogging] = useState<Loggable | null>(null);

  if (!data) return error ? <PageError message={error} /> : <PageSkeleton label="Checking your ideas…" />;

  async function remove(id: string) {
    await fetch(`/api/watch?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    reload();
  }

  const order = { go: 0, wait: 1, closed: 2, skip: 3, unknown: 4 };
  const checks = [...data.checks].sort((a, b) => order[a.verdict] - order[b.verdict] || b.score - a.score);

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <span className="pulse-dot size-1.5 rounded-full bg-up" /> Re-judged every 5 seconds
          </>
        }
        title="Watch"
        subtitle="Queue any trade you are thinking about. Strike checks it against the full analysis, short-term momentum, option flow, the price of the option, the clock and your plan, and tells you Go, Wait or Skip. You get an alert when a queued idea turns Go."
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <IdeaForm onAdded={reload} />
        {data.context && <ContextPanel ctx={data.context} />}
      </div>

      {checks.length === 0 ? (
        <Panel className="px-6 py-14 text-center">
          <div className="text-[16px] font-semibold tracking-[-0.02em]">Nothing queued</div>
          <p className="mx-auto mt-1.5 max-w-[56ch] text-[13px] leading-relaxed text-muted">
            Add a contract above, for example SPY puts one strike out of the money expiring today, and the verdict appears here and keeps updating.
          </p>
        </Panel>
      ) : (
        <div className="space-y-5">
          {checks.map((c) => (
            <IdeaCard key={c.idea.id} c={c} onRemove={() => remove(c.idea.id)} onLog={() => c.contract && setLogging(c.contract)} />
          ))}
        </div>
      )}

      {logging && <LogTradeDialog contract={logging} onClose={() => setLogging(null)} />}
    </Page>
  );
}

/** Ticker, side, expiry, strike and dollars. The chain loads as soon as the ticker is valid. */
function IdeaForm({ onAdded }: { onAdded: () => void }) {
  const [typed, setTyped] = useState("SPY");
  const [symbol, setSymbol] = useState("SPY");
  const [side, setSide] = useState<OptType>("put");

  // /watch?sym=NVDA&side=call opens the form on that contract (links from the Brief)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = (q.get("sym") ?? "").toUpperCase();
    if (/^[A-Z.]{1,6}$/.test(s)) {
      setTyped(s);
      setSymbol(s);
    }
    const sd = q.get("side");
    if (sd === "call" || sd === "put") setSide(sd);
  }, []);
  const [exp, setExp] = useState<string | undefined>();
  const [strike, setStrike] = useState<number | undefined>();
  const [dollars, setDollars] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const { data: view, error } = usePoll<SymbolView>(`/api/symbol?symbol=${encodeURIComponent(symbol)}${exp ? `&exp=${exp}` : ""}`, 5000);
  const { data: plan } = usePoll<PlanView>("/api/plan", 60_000);
  const loaded = view?.summary.quote.symbol === symbol ? view : undefined;
  const S = loaded?.summary.quote.price ?? 0;
  const planSize = plan ? (plan.budget > 0 ? plan.budget : plan.equity * plan.settings.riskPerTrade) : undefined;

  // default the dollars to the plan's size once it is known
  useEffect(() => {
    if (!dollars && planSize) setDollars(String(Math.round(planSize)));
  }, [planSize, dollars]);

  const { strikes, atm } = useMemo(() => {
    const ks = [...new Set((loaded?.contracts ?? []).filter((c) => c.type === side).map((c) => c.strike))].sort((a, b) => a - b);
    const atm = ks.reduce((b, k) => (Math.abs(k - S) < Math.abs(b - S) ? k : b), ks[0] ?? 0);
    return { strikes: ks, atm };
  }, [loaded, side, S]);

  /** n strikes out of the money from the one nearest the price (0 = at the money). */
  const otm = (n: number) => {
    const i = strikes.indexOf(atm);
    return strikes[Math.min(strikes.length - 1, Math.max(0, i + (side === "call" ? n : -n)))];
  };
  // keep a sensible default while the user has not chosen: one strike out of the money
  const chosen = strike !== undefined && strikes.includes(strike) ? strike : otm(1);
  const contract = loaded?.contracts.find((c) => c.type === side && c.strike === chosen);
  const each = contract ? (contract.ask || contract.mid) * 100 : 0;
  const qty = each > 0 ? Math.floor(Number(dollars) / each) : 0;
  const near = strikes.filter((k) => Math.abs(strikes.indexOf(k) - strikes.indexOf(atm)) <= 8);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  function load(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const s = typed.trim().toUpperCase();
    if (!/^[A-Z.]{1,6}$/.test(s)) return setErr("Enter a ticker, for example SPY");
    setErr("");
    if (s === symbol) return;
    setSymbol(s);
    setExp(undefined);
    setStrike(undefined);
  }

  async function add() {
    if (!loaded || chosen === undefined) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, type: side, strike: chosen, expiration: loaded.summary.exp, dollars: Number(dollars) }),
      });
      if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "Could not add the idea");
      else {
        toast(`Checking ${symbol} ${strikeLabel(chosen)}${side === "call" ? "C" : "P"}`, "up");
        onAdded();
      }
    } catch {
      setErr("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Check a trade" sub="Pick the contract and how much you want to put on it" />
      <div className="space-y-5 px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={load}>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              onBlur={() => load()}
              aria-label="Ticker"
              placeholder="Ticker"
              className={clsx(fieldClass, "!h-10 !w-28 text-[15px] font-semibold")}
            />
          </form>
          {loaded ? (
            <div className="flex items-baseline gap-2.5">
              <span className="num text-[20px] font-semibold tracking-[-0.03em]">{usd(S)}</span>
              <Change value={loaded.summary.quote.changePct} className="text-[13px]" />
              <span className="hidden text-[12.5px] text-faint sm:inline">{loaded.summary.quote.name}</span>
            </div>
          ) : (
            <span className="text-[12.5px] text-muted">{error ? <span className="text-down">{error}</span> : `Loading ${symbol}…`}</span>
          )}
          <div className="ml-auto">
            <Segmented
              value={side}
              onChange={(v) => {
                setSide(v);
                setStrike(undefined);
              }}
              options={[
                { value: "call", label: "Call" },
                { value: "put", label: "Put" },
              ]}
            />
          </div>
        </div>

        {loaded && (
          <>
            <div>
              <div className="mb-2 text-[12px] text-muted">Expires</div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {loaded.expirations.slice(0, 10).map((e) => (
                  <Chip key={e} active={e === loaded.summary.exp} onClick={() => setExp(e)}>
                    {e === today ? "Today" : shortDate(e)}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between text-[12px] text-muted">
                <span>Strike</span>
                <span className="text-faint">
                  {[0, 1, 2, 3].map((n) => (
                    <button key={n} onClick={() => setStrike(otm(n))} className="ml-3 text-[12px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
                      {n === 0 ? "At the money" : `${n} out`}
                    </button>
                  ))}
                </span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {near.map((k) => (
                  <Chip key={k} active={k === chosen} onClick={() => setStrike(k)} className={clsx("num", k === atm && k !== chosen && "ring-1 ring-line-strong")}>
                    {strikeLabel(k)}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <label className="block">
                <span className="text-[12px] text-muted">Dollars to put on it</span>
                <span className="relative mt-1.5 block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-faint">$</span>
                  <input type="number" min="1" step="any" value={dollars} onChange={(e) => setDollars(e.target.value)} className={clsx(fieldClass, "num !h-10 !w-36 pl-6 text-[14px]")} />
                </span>
              </label>
              {planSize && Math.round(planSize) !== Number(dollars) && (
                <button onClick={() => setDollars(String(Math.round(planSize)))} className="h-10 px-2 text-[12.5px] text-muted underline-offset-4 hover:text-fg hover:underline">
                  Use plan size ({usd(planSize, 0)})
                </button>
              )}
              <div className="ml-auto text-right">
                {contract && (
                  <div className="num text-[12.5px] text-muted">
                    <span className={side === "call" ? "text-up" : "text-down"}>{contractLabel(contract)}</span> · ask {contract.ask.toFixed(2)} ·{" "}
                    {qty > 0 ? `${qty} contract${qty === 1 ? "" : "s"}` : "under one contract"}
                  </div>
                )}
                <Button variant="primary" className="mt-2 !h-10 !rounded-xl px-5 !text-[13.5px]" disabled={busy || !contract || !(Number(dollars) > 0)} onClick={add}>
                  {busy ? "Adding…" : "Check this trade"}
                </Button>
              </div>
            </div>
          </>
        )}
        {err && <p className="text-[12.5px] text-down">{err}</p>}
      </div>
    </Panel>
  );
}

const ENTRY = { early: "Early", "in play": "In play", late: "Late", against: "Against today's move" } as const;

const STATUS_ICON = {
  pass: <Check size={12} strokeWidth={3} />,
  warn: <Minus size={12} strokeWidth={3} />,
  fail: <X size={12} strokeWidth={3} />,
};
const STATUS_STYLE = { pass: "bg-up/15 text-up", warn: "bg-warn/15 text-warn", fail: "bg-down/15 text-down" };

function IdeaCard({ c, onRemove, onLog }: { c: IdeaCheck; onRemove: () => void; onLog: () => void }) {
  const v = VERDICT[c.verdict];
  const i = c.idea;
  const up = i.type === "call";
  const ringTone = c.verdict === "go" ? "up" : c.verdict === "skip" ? "down" : c.verdict === "wait" ? "warn" : "neutral";
  const o = c.order;

  return (
    <Panel tone={v.tone === "neutral" ? "neutral" : v.tone}>
      <div className="grid gap-x-8 gap-y-5 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <Ring value={c.score / 100} size={76} stroke={7} tone={ringTone}>
              <span className="num text-[19px] font-semibold tracking-[-0.03em]">{c.verdict === "unknown" ? "—" : c.score}</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={v.tone} className="!h-6 !px-2.5 !text-[12px]">
                  {v.label}
                </Badge>
                <Link href={`/s/${i.symbol}`} className="text-[17px] font-semibold tracking-[-0.02em] hover:underline">
                  {i.symbol} <span className={up ? "text-up" : "text-down"}>{contractLabel(i)}</span>
                </Link>
                {c.spot !== undefined && <span className="num text-[12.5px] text-muted">{usd(c.spot)}</span>}
                {c.entry && <Badge tone={c.entry === "late" ? "down" : c.entry === "against" ? "warn" : "mute"}>{ENTRY[c.entry]}</Badge>}
                {i.source === "signal" && <Badge tone="accent" title="Strike queued this from a strong signal that was not yet a buy. It is removed after today.">From a signal</Badge>}
              </div>
              <div className="mt-1.5 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{c.headline}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{c.action}</p>
            </div>
          </div>

          {c.held && (
            <Link href="/positions" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-accent/12 px-4 py-3 text-[13px] transition-opacity hover:opacity-80">
              <span>
                <span className="font-semibold text-accent">You hold {c.held.qty} of these</span>
                <span className="text-muted"> at {usd(c.held.entryPrice)}. The live sell or hold call is in Positions; the read here is for adding more.</span>
              </span>
              <span className="shrink-0 font-medium text-accent">Open</span>
            </Link>
          )}

          {o && c.contract && (
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-raised/50 px-4 py-3.5 sm:grid-cols-4">
              {(
                [
                  [`${o.qty} × limit`, usd(o.limit), `${usd(o.cost, 0)} total`],
                  ["Take profit", usd(o.target), `+${usd(o.targetGain, 0)}`, "text-up"],
                  ["Stop", usd(o.stop), `−${usd(o.maxLoss, 0)}`, "text-down"],
                  ["Out by", o.sellBy.split(", ").slice(-1)[0], o.sellBy.split(", ").slice(0, -1).join(", ")],
                ] as [string, string, string, string?][]
              ).map(([label, value, sub, tone]) => (
                <div key={label} className="min-w-0">
                  <div className="truncate text-[11.5px] text-faint">{label}</div>
                  <div className={clsx("num mt-0.5 truncate text-[14px] font-semibold", tone)}>{value}</div>
                  <div className="num truncate text-[11.5px] text-muted">{sub}</div>
                </div>
              ))}
            </div>
          )}

          <ul className="mt-4 space-y-1.5 text-[12.5px] leading-snug text-muted">
            {c.needs && c.spot !== undefined && (
              <li>
                For the target, {i.symbol} has to reach <span className="num text-fg">{usd(c.needs.price)}</span> ({signedPct(c.needs.movePct, 2)}) about halfway through the hold.
              </li>
            )}
            {c.marketOrderCost !== undefined && c.marketOrderCost >= 1 && (
              <li>
                A market order gives away about <span className="num text-warn">{usd(c.marketOrderCost, 0)}</span> to the spread. Use the limit.
              </li>
            )}
            {c.planSize && o && o.cost > c.planSize.budget * 1.05 && (
              <li>
                At your plan&apos;s size this is{" "}
                <span className="text-fg">
                  {c.planSize.qty > 0 ? `${c.planSize.qty} contract${c.planSize.qty === 1 ? "" : "s"} (${usd(c.planSize.cost, 0)})` : "less than one contract"}
                </span>
                , not {o.qty}.
              </li>
            )}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {c.contract && (
              <>
                <Link href={ticketHref(c.contract)}>
                  <Button>Scenarios</Button>
                </Link>
                <Button variant="ghost" onClick={onLog}>
                  Log purchase
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={onRemove}>
              <Trash2 size={13} /> Remove
            </Button>
          </div>
        </div>

        <ul className="min-w-0 space-y-2.5">
          {c.items.map((it) => (
            <li key={it.key} className="flex gap-3">
              <span className={clsx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", STATUS_STYLE[it.status])}>{STATUS_ICON[it.status]}</span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium">{it.label}</div>
                <div className="text-[12.5px] leading-snug text-muted">{it.detail}</div>
              </div>
            </li>
          ))}
          {!c.items.length && <li className="text-[13px] text-muted">No checks could run for this idea.</li>}
        </ul>
      </div>
    </Panel>
  );
}
