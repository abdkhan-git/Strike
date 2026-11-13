import { buildBrief } from "./brief";
import { checkAll, checkContract } from "./check";
import { contractText } from "./instruction";
import { contractLabel, pct, usd } from "./format";
import { signals } from "./market";
import { latestBriefing, runBriefing } from "./picks";
import { markPaper } from "./paper";
import { currentPlan } from "./plan";
import { tradeViews } from "./positions";
import { etDay, session } from "./session";
import { recordSignals, scoreTrack } from "./track";
import { readAlerts, readAlertSettings, readWatch, writeAlerts, writeWatch } from "./store";
import type { Alert, AlertSettings, AlertsView, Horizon, Signal, TradeView } from "./types";

/**
 * Background watcher. Once a minute while the market is open (plus the hour before and
 * after) it compares open positions, signals and today's P/L with what it saw last time
 * and records an alert for anything that needs action. Alerts are stored in
 * data/alerts.json, shown in the app, and pushed to the phone through ntfy when enabled.
 *
 * On the first pass after a restart it only records the current state, so a restart
 * never floods you with alerts for things that were already true.
 */

const EVERY = 60_000;
const KEEP = 200;
const HORIZON: Record<Horizon, string> = { eod: "today", week: "this week", month: "1 month", quarter: "2 months" };

export const DEFAULT_SETTINGS: AlertSettings = { verdicts: true, signalMin: 80, risk: true, phone: true, picks: true, brief: true };

type State = {
  v?: number;
  timer?: ReturnType<typeof setInterval>;
  /** the pass in progress, so a second caller waits for it instead of starting another */
  running?: Promise<void>;
  primed: boolean;
  checkedAt?: number;
  verdicts: Map<string, string>;
  /** watchlist idea id -> last verdict seen */
  watch: Map<string, string>;
  /** symbol|horizon|direction already alerted today */
  signalsSeen: Set<string>;
  day: string;
  riskSent: boolean;
  /** the day's pre-market brief and post-market round-up have gone out */
  briefPre: boolean;
  briefPost: boolean;
};

// On globalThis so a hot reload in development does not start a second timer. The version
// resets the state (and stops the old timer) when this file's shape changes.
const VERSION = 6;
const g = globalThis as { __strikeWatch?: State & { v?: number } };
if (g.__strikeWatch && g.__strikeWatch.v !== VERSION) {
  clearInterval(g.__strikeWatch.timer);
  g.__strikeWatch = undefined;
}
const state: State = (g.__strikeWatch ??= {
  v: VERSION,
  primed: false,
  verdicts: new Map(),
  watch: new Map(),
  signalsSeen: new Set(),
  day: "",
  riskSent: false,
  briefPre: false,
  briefPost: false,
});

export async function alertSettings(): Promise<AlertSettings> {
  return { ...DEFAULT_SETTINGS, ...((await readAlertSettings()) ?? {}) };
}

const topic = () => process.env.NTFY_TOPIC?.trim();

/** Push one alert to the ntfy topic. The topic name is the only secret: keep it long and random. */
async function pushPhone(a: Alert) {
  const t = topic();
  if (!t) return;
  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const base = process.env.APP_URL?.replace(/\/$/, "");
  try {
    await fetch(`${server}/${encodeURIComponent(t)}`, {
      method: "POST",
      body: a.body,
      headers: {
        Title: a.title.replace(/[^\x20-\x7E]/g, ""),
        Priority: a.title.startsWith("BUY NOW") ? "urgent" : a.tone === "down" || a.kind === "risk" || a.kind === "picks" ? "high" : "default",
        Tags: a.tone === "up" ? "chart_with_upwards_trend" : a.tone === "down" ? "warning" : "bell",
        ...(base && a.href ? { Click: base + a.href } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn("[alerts] phone push failed:", e instanceof Error ? e.message : e);
  }
}

async function record(fresh: Omit<Alert, "id" | "at" | "read">[], settings: AlertSettings) {
  if (!fresh.length) return;
  const made: Alert[] = fresh.map((a) => ({ ...a, id: crypto.randomUUID(), at: Date.now(), read: false }));
  await writeAlerts([...made.reverse(), ...(await readAlerts())].slice(0, KEEP));
  if (settings.phone) for (const a of made) await pushPhone(a);
}

/** One pass of the watcher. Exported so the alerts route can run it on demand. */
export function checkNow(): Promise<void> {
  state.running ??= runCheck().finally(() => {
    state.running = undefined;
  });
  return state.running;
}

async function runCheck() {
  try {
    const settings = await alertSettings();
    const today = etDay();
    if (today !== state.day) {
      state.day = today;
      state.signalsSeen.clear();
      state.riskSent = false;
      state.briefPre = false;
      state.briefPost = false;
    }
    const out: Omit<Alert, "id" | "at" | "read">[] = [];
    const trades = await tradeViews();

    // positions whose call changed to one that needs action (sell, sell half, trim, or a bad position)
    const open = trades.filter((t) => t.status === "open");
    for (const t of open) {
      const v = t.verdict;
      if (!v) continue;
      const before = state.verdicts.get(t.id);
      state.verdicts.set(t.id, v.call);
      const needsAction = v.move !== "keep" || v.quality === "bad";
      if (!state.primed || !settings.verdicts || before === v.call || !needsAction) continue;
      out.push({
        kind: "verdict",
        tone: v.tone,
        title: `${v.call}: ${t.underlying} ${contractLabel(t)}`,
        body: `${t.verdict!.headline} Now ${t.mark != null ? usd(t.mark) : "—"}, entry ${usd(t.entryPrice)} (${t.pnlPct >= 0 ? "+" : ""}${pct(t.pnlPct, 0)}).`,
        href: "/positions",
      });
    }
    for (const id of state.verdicts.keys()) if (!open.some((t) => t.id === id)) state.verdicts.delete(id);

    // new strong signals
    if (settings.signalMin > 0) {
      for (const s of (await signals()).signals) {
        if (s.conviction < settings.signalMin) continue;
        const key = `${s.symbol}|${s.horizon}|${s.direction}`;
        if (state.signalsSeen.has(key)) continue;
        state.signalsSeen.add(key);
        if (!state.primed) continue;
        out.push(await signalAlert(s, trades));
      }
    }

    // daily loss limit
    if (settings.risk && !state.riskSent) {
      const plan = await currentPlan(trades);
      if (plan.halted) {
        state.riskSent = true;
        if (state.primed)
          out.push({
            kind: "risk",
            tone: "down",
            title: "Daily loss limit reached",
            body: `Down ${usd(-plan.todayPnl)} today. The plan pauses new trades until tomorrow.`,
            href: "/plan",
          });
      }
    }

    // morning picks: once a weekday, 15 minutes after the open when option flow has formed
    const { state: sess, time } = session(new Date());
    const [hh, mm] = time.split(/[: ]/).map(Number);
    if (settings.picks && sess === "Market open" && hh * 60 + mm >= 9 * 60 + 45) {
      const last = await latestBriefing();
      const minutes = hh * 60 + mm;
      if (last?.day !== today) {
        const { briefing, title, body } = await runBriefing();
        out.push({ kind: "picks", tone: briefing.picks.length ? "up" : "neutral", title, body, href: "/plan" });
      } else if (Date.now() - last.at > 30 * 60_000 && minutes < 15 * 60 + 30) {
        // re-rank every 30 minutes as flow, momentum and news move; alert only when the list changes
        const before = last.picks.map((p) => p.symbol).join(",");
        const { briefing, title, body } = await runBriefing();
        if (briefing.picks.map((p) => p.symbol).join(",") !== before)
          out.push({ kind: "picks", tone: "neutral", title: title.replace(/^Strike:/, "Picks updated:"), body, href: "/plan" });
      }
    }

    // watchlist: tell the user the moment an idea they queued lines up
    const ideas = await readWatch();
    if (ideas.length && sess === "Market open") {
      for (const c of await checkAll(ideas)) {
        const before = state.watch.get(c.idea.id);
        state.watch.set(c.idea.id, c.verdict);
        // nothing to say about a contract you already bought: Positions takes over from here
        if (!state.primed || c.held || c.verdict !== "go" || before === "go" || before === undefined) continue;
        out.push({
          kind: "watch",
          tone: c.idea.type === "call" ? "up" : "down",
          title: `BUY NOW: ${contractText({ underlying: c.idea.symbol, ...c.idea })} (score ${c.score})`,
          body: `Every check lines up right now. ${c.order?.text ?? c.action}`,
          href: "/watch",
        });
      }
    }
    for (const id of state.watch.keys()) if (!ideas.some((i) => i.id === id)) state.watch.delete(id);
    // ideas Strike queued from a signal only live for the day they were added
    if (ideas.some((i) => i.source === "signal" && etDay(i.createdAt) !== today)) await writeWatch((await readWatch()).filter((i) => i.source !== "signal" || etDay(i.createdAt) === today));

    // pre-market brief at 9:00 ET and post-market round-up at 4:05 pm ET, once each
    if (settings.brief && state.primed) {
      const mins = hh * 60 + mm;
      const pre = sess === "Pre-market" && mins >= 9 * 60 && !state.briefPre;
      const post = sess === "After hours" && mins >= 16 * 60 + 5 && mins < 18 * 60 && !state.briefPost;
      if (pre || post) {
        if (pre) state.briefPre = true;
        else state.briefPost = true;
        const brief = await buildBrief().catch(() => undefined);
        if (brief) out.push({ kind: "brief", tone: "neutral", title: brief.push.title, body: brief.push.body, href: "/brief" });
      }
    }

    // paper lab: manage every pick by the exit rules
    await markPaper().catch((e) => console.warn("[paper] mark failed:", e instanceof Error ? e.message : e));

    // track record: log today's strong signals and score anything that has come due
    await recordSignals((await signals()).signals);
    await scoreTrack();

    state.primed = true;
    state.checkedAt = Date.now();
    await record(out, settings);
  } catch (e) {
    console.warn("[alerts] check failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * A new strong signal, with a verdict on entering it right now. The lead contract is run
 * through the same trade check as the Watch page at the plan's size:
 *   go    -> "BUY NOW" with the exact order
 *   late  -> "Too late to chase": the move has mostly happened
 *   wait  -> "Not yet", and the contract is queued in Watch so a later Go alerts you
 *   skip  -> the signal is reported with the reason it is not a trade
 */
async function signalAlert(s: Signal, trades: TradeView[]): Promise<Omit<Alert, "id" | "at" | "read">> {
  const up = s.direction === "bullish";
  const base = {
    kind: "signal" as const,
    tone: up ? ("up" as const) : ("down" as const),
    title: `${s.symbol} ${s.direction}, ${HORIZON[s.horizon]} (conviction ${s.conviction})`,
    body: s.reasons.slice(0, 2).join(". ") + ".",
    href: `/s/${s.symbol}`,
  };
  const lead = s.lead;
  if (!lead) return base;
  try {
    const plan = await currentPlan(trades);
    const dollars = Math.max(lead.ask * 100, plan.budget > 0 ? plan.budget : plan.equity * plan.settings.riskPerTrade);
    const idea = { id: `signal:${lead.occ}`, symbol: s.symbol, type: lead.type, strike: lead.strike, expiration: lead.expiration, dollars, createdAt: Date.now() };
    const c = await checkContract(idea, { plan });
    const name = contractText(lead);
    const flow = `Flow: ${s.reasons[0]}.`;
    const failing = c.items.filter((i) => i.status === "fail").map((i) => i.label.toLowerCase());
    if (trades.some((t) => t.status === "open" && t.occ === lead.occ)) return { ...base, title: `${base.title}: you already hold ${name}`, href: "/positions" };
    if (c.verdict === "go")
      return { ...base, kind: "watch", title: `BUY NOW: ${name} (score ${c.score}, conviction ${s.conviction})`, body: `Every check lines up and the entry is ${c.entry ?? "open"}. ${c.order?.text ?? ""} ${flow}`, href: "/watch" };
    if (c.entry === "late")
      return { ...base, tone: "warn", title: `Too late to chase: ${s.symbol} ${s.direction} (conviction ${s.conviction})`, body: `${c.items.find((i) => i.key === "entry")?.detail ?? ""} ${flow}` };
    if (c.verdict === "wait") {
      const ideas = await readWatch();
      const queued = ideas.some((i) => i.symbol === idea.symbol && i.type === idea.type && i.strike === idea.strike && i.expiration === idea.expiration);
      if (!queued && ideas.length < 12) await writeWatch([{ ...idea, id: crypto.randomUUID(), source: "signal" }, ...ideas]);
      return { ...base, title: `Not yet: ${name} (score ${c.score}, conviction ${s.conviction})`, body: `${c.action} Queued in Watch: you get a BUY NOW alert if it lines up today. ${flow}`, href: "/watch" };
    }
    return { ...base, tone: "neutral", title: `No trade: ${s.symbol} ${s.direction} flow (conviction ${s.conviction})`, body: `${c.headline}${failing.length ? ` (${failing.join(", ")})` : ""}. ${c.action} ${flow}` };
  } catch (e) {
    console.warn("[alerts] could not judge the signal:", e instanceof Error ? e.message : e);
    return base;
  }
}

/** Starts the once-a-minute watcher. Safe to call more than once. */
export function startWatcher() {
  if (state.timer) return;
  const tick = () => {
    const s = session(new Date()).state;
    // regular session plus the hour either side; nothing changes overnight
    if (s === "Market open" || s === "Pre-market" || s === "After hours") void checkNow();
  };
  state.timer = setInterval(tick, EVERY);
  setTimeout(tick, 5_000);
  console.log("[alerts] watcher started");
}

export async function alertsView(): Promise<AlertsView> {
  const alerts = await readAlerts();
  return {
    alerts: alerts.slice(0, 50),
    unread: alerts.filter((a) => !a.read).length,
    settings: await alertSettings(),
    phoneReady: !!topic(),
    checkedAt: state.checkedAt,
    watching: !!state.timer,
  };
}

export async function markAllRead() {
  const alerts = await readAlerts();
  if (alerts.some((a) => !a.read)) await writeAlerts(alerts.map((a) => ({ ...a, read: true })));
}

export async function sendTest() {
  await record(
    [{ kind: "test", tone: "neutral", title: "Strike test alert", body: "Alerts are working. This is what a position or signal alert will look like.", href: "/positions" }],
    await alertSettings(),
  );
}
