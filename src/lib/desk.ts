import type { Enriched, Horizon, OptType } from "./types";

/** Types shared by the trade check, the market context and the paper lab. No server imports. */

/** A trade the user is thinking about making. */
export interface Idea {
  id: string;
  symbol: string;
  type: OptType;
  strike: number;
  expiration: string;
  /** dollars the user wants to put on it */
  dollars: number;
  createdAt: number;
  /** queued by Strike from a strong signal that was not yet a buy; cleared after the day it was added */
  source?: "signal";
}

export interface CheckItem {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

/** The live judgement of one idea. Fixed rules over live data; nothing here is a forecast. */
export interface IdeaCheck {
  idea: Idea;
  /** go: every check clears. wait: nothing disqualifies it, but the evidence is not there yet. skip: something disqualifies it. */
  verdict: "go" | "wait" | "skip" | "closed" | "unknown";
  /** 0-100: weighted share of the checks that pass */
  score: number;
  headline: string;
  /** what to do about it, in one or two sentences */
  action: string;
  items: CheckItem[];
  /** where the move stands: is there still room, or is this chasing */
  entry?: "early" | "in play" | "late" | "against";
  /** the user already holds this contract (from the trade log) */
  held?: { qty: number; entryPrice: number };
  contract?: Enriched;
  spot?: number;
  horizon?: Horizon;
  /** the order as asked for (sized to the idea's dollars) */
  order?: { qty: number; limit: number; cost: number; target: number; targetGain: number; stop: number; maxLoss: number; sellBy: string; text: string };
  /** what the same trade looks like at the plan's size */
  planSize?: { budget: number; qty: number; cost: number };
  /** the stock price that gets the option to its profit target about halfway through the hold */
  needs?: { price: number; movePct: number };
  /** dollars a market order gives up to the spread compared with the limit */
  marketOrderCost?: number;
  /** dollars of value lost per hour (same-day) or per day if the stock stands still */
  decay?: { amount: number; per: "hour" | "day"; pct: number };
  asOf: number;
}

export interface MarketEvent {
  date: string;
  label: string;
  kind: "fed" | "jobs" | "opex" | "earnings" | "holiday";
  /** days from today, 0 = today */
  inDays: number;
}

/** The backdrop every trade sits in: which way the market leans, how nervous it is, and what is scheduled. */
export interface MarketContext {
  asOf: number;
  session: string;
  regime: { label: "Uptrend" | "Downtrend" | "Mixed"; score: number; note: string };
  vol: { label: "Calm" | "Normal" | "Elevated" | "Stressed"; atmIv: number; realized?: number; note: string };
  spy?: { price: number; changePct: number; expectedMovePct: number; vsVwap?: number };
  events: MarketEvent[];
  /** one-line cautions that apply to any new trade today */
  cautions: string[];
}

export interface PaperTrade {
  id: string;
  day: string;
  at: number;
  symbol: string;
  direction: "bullish" | "bearish";
  horizon: Horizon;
  occ: string;
  type: OptType;
  strike: number;
  expiration: string;
  qty: number;
  /** filled at the ask when the pick was made: the price you could really have bought at */
  entry: number;
  target: number;
  stop: number;
  sellByAt: number;
  invalidation?: number;
  status: "open" | "closed";
  mark?: number;
  exit?: number;
  exitAt?: number;
  exitReason?: "target" | "stop" | "time" | "thesis" | "expiry";
  /** the plan had paused trading when this pick was made */
  paused?: boolean;
}

export interface PaperView {
  trades: (PaperTrade & { pnl: number; pnlPct: number })[];
  stats: {
    n: number;
    open: number;
    closed: number;
    pnl: number;
    openPnl: number;
    winRate: number;
    avgWinPct: number;
    avgLossPct: number;
    /** average dollars per closed trade */
    expectancy: number;
  };
  /** cumulative closed P/L by day, oldest first */
  curve: { day: string; pnl: number; cum: number }[];
}

/** The pre-market brief or post-market round-up: one page of what matters for the session. */
export interface Brief {
  asOf: number;
  day: string;
  /** pre: before the open. open: session running. post: after the close. closed: weekend or holiday */
  phase: "pre" | "open" | "post" | "closed";
  title: string;
  /** the few sentences worth reading if you read nothing else */
  lines: string[];
  context: MarketContext;
  movers: { symbol: string; price: number; changePct: number }[];
  plan: { equity: number; budget: number; needToday: number; todayPnl: number; todayOpenPnl: number; halted: boolean; style: string; notes: string[] };
  positions: { id: string; label: string; type: OptType; qty: number; pnl: number; pnlPct: number; call?: string; tone?: "up" | "down" | "warn" | "neutral"; doNow?: string; sellBy?: string; needsAction: boolean }[];
  picks: { symbol: string; label: string; type: OptType; day: string; entry: number; pnl?: number; pnlPct?: number; status: string; held: boolean }[];
  /** today's closed trades */
  result?: { pnl: number; trades: number; wins: number };
  nextSession: string;
  checklist: { when: string; text: string }[];
  /** the same brief as a phone notification */
  push: { title: string; body: string };
}
