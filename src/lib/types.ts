export type OptType = "call" | "put";

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
}

export interface Catalyst {
  kind: "earnings" | "news" | "flow";
  label: string;
  date?: string;
}

export interface OptionContract {
  occ: string;
  underlying: string;
  type: OptType;
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface Enriched extends OptionContract {
  mid: number;
  spreadPct: number;
  volOi: number;
  /** market-implied probability the long position is profitable at expiry */
  pop: number;
  breakeven: number;
  dte: number;
  /** 0-100 flow score: unusual activity + liquidity. Not a profit prediction. */
  score: number;
  /** dollars traded today (volume x mid x 100) */
  premiumFlow: number;
  /** where the last trade printed inside the quote: 0 = at the bid, 1 = at the ask */
  lastPos: number;
  /** one-line read of why this contract stands out, built from the figures above */
  why?: string;
  /** model-written note tying the flow to recent headlines, when one has been generated */
  ai?: { line: string; model: string };
}

export interface Headline {
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  /** published time, ms */
  at: number;
}

/** Model-written digest of a symbol's recent headlines. Describes the news, not the stock's direction. */
export interface Brief {
  summary: string;
  drivers: string[];
  tone: "positive" | "negative" | "mixed" | "quiet";
  model: string;
  at: number;
}

export interface NewsResult {
  symbol: string;
  headlines: Headline[];
  brief?: Brief;
  /** true while a brief is being written for the first time */
  pending: boolean;
}

export type Horizon = "eod" | "week" | "month" | "quarter";

/** One-sided option positioning in a symbol for one expiration window. Describes flow, not a forecast. */
export interface Signal {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  horizon: Horizon;
  exp: string;
  dte: number;
  direction: "bullish" | "bearish";
  /** 0-100: how lopsided, unusual, large and out-of-the-money the dominant side is */
  conviction: number;
  /** share of premium on the dominant side, 0.5-1 */
  share: number;
  /** total option premium traded today in this expiration, dollars */
  premium: number;
  /** dominant-side volume / open interest */
  volOi: number;
  lead?: Enriched;
  reasons: string[];
  catalyst?: Catalyst;
}

export interface SignalsResult {
  provider: ProviderInfo;
  asOf: number;
  signals: Signal[];
}

export interface SymbolSummary {
  quote: Quote;
  catalyst?: Catalyst;
  exp: string;
  callVol: number;
  putVol: number;
  pcRatio: number;
  /** -1 (all put premium) .. +1 (all call premium) */
  flowBias: number;
  expectedMovePct: number;
  atmIv: number;
  score: number;
  top: Enriched[];
}

export interface ProviderInfo {
  name: string;
  simulated: boolean;
  realtime: boolean;
  note: string;
}

export interface ScanResult {
  provider: ProviderInfo;
  asOf: number;
  rows: SymbolSummary[];
  top: Enriched[];
}

export interface SymbolView {
  provider: ProviderInfo;
  asOf: number;
  summary: SymbolSummary;
  expirations: string[];
  contracts: Enriched[];
}

export interface Trade {
  id: string;
  occ: string;
  underlying: string;
  type: OptType;
  strike: number;
  expiration: string;
  qty: number;
  entryPrice: number;
  entryAt: number;
  status: "open" | "closed";
  exitPrice?: number;
  exitAt?: number;
  note?: string;
  /** "broker": rebuilt from brokerage fills on every sync; anything else was logged by hand */
  source?: "broker";
}

export interface TradeView extends Trade {
  mark?: number;
  /** live per-share delta and daily theta of the contract, for the exposure view */
  delta?: number;
  theta?: number;
  spot?: number;
  pnl: number;
  pnlPct: number;
  verdict?: Verdict;
}

/** One price bar. `t` is the bar's start, ms. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Momentum read for the next few minutes, built from one-minute bars. A lean and a
 * typical range, not a forecast: short-term direction is close to a coin flip.
 */
export interface Outlook {
  horizonMin: number;
  lean: "up" | "down" | "flat";
  /** 0-100, how strongly the inputs agree */
  strength: number;
  sentence: string;
  /** one standard deviation of a `horizonMin` move, dollars */
  move: number;
  low: number;
  high: number;
  vwap: number;
  vsVwap: number;
  ret5: number;
  ret15: number;
  rsi: number;
  /** where price sits in today's range, 0 = low, 1 = high */
  dayPos: number;
}

/** Daily-bar context: trend and how much the stock has actually been moving. */
export interface Trend {
  sma20: number;
  vsSma20: number;
  /** 20-day realized volatility, annualised */
  rv20: number;
  high20: number;
  low20: number;
}

export interface ChartResult {
  symbol: string;
  asOf: number;
  prevClose: number;
  bars: Bar[];
  daily: Bar[];
  outlook?: Outlook;
  trend?: Trend;
}

/** What to do with an open position right now, from fixed rules over live data. */
export interface Verdict {
  action: "Take profit" | "Sell" | "Trim" | "Hold" | "Wait";
  /** the plain call, e.g. "Good position, sell now" or "Losing, but worth keeping open" */
  call: string;
  quality: "good" | "mixed" | "bad";
  /** sell, reduce or hold: what to do with the order ticket */
  move: "sell" | "sell-half" | "trim" | "keep";
  tone: "up" | "down" | "warn" | "neutral";
  headline: string;
  reasons: string[];
  /** implied odds the stock is past the position's break-even at expiry */
  odds: number;
  /** implied odds the stock touches the level where the premium doubles, before expiry */
  doubleOdds: number;
  /** dollars of time value the position loses per day */
  decayPerDay: number;
  dte: number;
  /** option prices of the profit target and the stop, from the exit rules for this contract's horizon */
  target: number;
  stop: number;
  targetPct: number;
  stopPct: number;
  /** latest time to be out of the position */
  sellBy: string;
  /** the exact order to place now, e.g. "Sell 2 of 4 now at a limit of $6.20." */
  doNow: string;
  /** a hard exit (target, stop, thesis broken, time): shown at once instead of waiting to confirm */
  urgent: boolean;
  /** the case the position was opened on, and the stock price that breaks it */
  thesis?: { text: string; invalidation: number; reason: string; source: "pick" | "auto" };
  /** full analysis score now, -100..+100, and at entry */
  analysis?: { score: number; atEntry: number; reversalSigns: string[] };
}

export interface PlanSettings {
  startCapital: number;
  goal: number;
  /** ISO dates */
  startDate: string;
  targetDate: string;
  /** share of the account risked on one trade, e.g. 0.05 */
  riskPerTrade: number;
  /** stop trading for the day after losing this share of the account, e.g. 0.1 */
  dailyLossLimit: number;
  maxOpen: number;
  /** how hard to push: sets the defaults above plus how many picks and which expiries */
  style?: PlanStyle;
}

export type PlanStyle = "focused" | "steady" | "aggressive" | "max";

export interface PlanView {
  settings: PlanSettings;
  /** start capital plus realized and open P/L from the trade log */
  equity: number;
  realized: number;
  openPnl: number;
  /** where the account would be today on a steady path from start to goal */
  onPace: number;
  tradingDaysLeft: number;
  /** compounded gain needed every remaining trading day */
  requiredDaily: number;
  /** dollars the account has to gain today, and over the next five sessions, to stay on that path */
  needToday: number;
  needWeek: number;
  /** realized today */
  todayPnl: number;
  /** unrealized P/L on positions opened today */
  todayOpenPnl: number;
  lastDayPnl?: number;
  losingStreak: number;
  openCount: number;
  /** dollars to risk on the next trade, after the adjustments in `notes` */
  budget: number;
  /** why today's budget is what it is, and anything else the day's rules say */
  notes: string[];
  halted: boolean;
  /** realized P/L for every day with a closed trade, oldest first */
  days: DayPnl[];
  /** average realized P/L over the last 20 days traded */
  avgDay?: number;
  winDays: number;
  lossDays: number;
}

/** Realized result of one New York calendar day. */
export interface DayPnl {
  day: string;
  pnl: number;
  trades: number;
  wins: number;
}

export interface BrokerAccount {
  id: string;
  name: string;
  institution: string;
  total?: number;
  cash?: number;
  currency?: string;
}

export interface BrokerOption {
  accountId: string;
  ticker: string;
  underlying: string;
  type: OptType;
  strike: number;
  expiration: string;
  qty: number;
  avgPrice?: number;
  price?: number;
}

export interface BrokerView {
  /** SnapTrade keys are present in the environment */
  configured: boolean;
  /** a SnapTrade user exists for this install */
  linked: boolean;
  accounts: BrokerAccount[];
  options: BrokerOption[];
  error?: string;
}

/** One morning pick: a sized trade with the evidence for it. */
export interface TradePick {
  rank: number;
  symbol: string;
  name: string;
  direction: "bullish" | "bearish";
  horizon: Horizon;
  /** 0-100 blend of the signal's conviction and how many other things agree with it */
  score: number;
  conviction: number;
  contract: Enriched;
  spot: number;
  qty: number;
  cost: number;
  /** option prices for the profit target and the stop, from the exit rules for its horizon */
  target: number;
  stop: number;
  /** stock move needed to break even, as a share of a typical move to expiry (1 = one standard deviation) */
  reach: number;
  reasons: string[];
  /** the case for the trade in plain words, written when it was picked */
  thesis?: string;
  /** stock price at which the case is wrong and the trade should be closed */
  invalidation?: number;
  invalidationReason?: string;
  /** the full analysis score at pick time, -100..+100 */
  analysisScore?: number;
  risks?: string[];
  /** who made the final choice: an AI model label, or "rules" */
  decidedBy?: string;
}

/** The reason a position was opened, kept so it is judged against the same case later. */
export interface Thesis {
  occ: string;
  symbol: string;
  direction: "bullish" | "bearish";
  text: string;
  invalidation: number;
  invalidationReason: string;
  scoreAtEntry: number;
  at: number;
  source: "pick" | "auto";
}

export interface Briefing {
  day: string;
  at: number;
  equity: number;
  budget: number;
  cash?: number;
  picks: TradePick[];
  /** caveats about today's list, e.g. cash on hand is below the total cost */
  notes: string[];
  /** the plan says no new trades right now (loss limit hit or no free slots) */
  paused?: boolean;
  /** why the other candidates were passed over, or why there is no trade */
  passed?: string;
  /** what the goal asked of the day when the picks were made, dollars */
  needToday?: number;
}

export type Checkpoint = "h1" | "close" | "d1" | "expiry";

/** A pick or a strong signal, recorded when it appeared and scored afterwards on its contract's price. */
export interface TrackRecord {
  id: string;
  kind: "pick" | "signal";
  day: string;
  at: number;
  symbol: string;
  direction: "bullish" | "bearish";
  horizon: Horizon;
  conviction: number;
  score?: number;
  occ: string;
  type: OptType;
  strike: number;
  expiration: string;
  /** ask when recorded: what buying it would have cost */
  entry: number;
  spotAtEntry: number;
  marks: Partial<Record<Checkpoint, { at: number; mark: number; ret: number }>>;
  /** best mid seen while it was open, sampled every few minutes */
  peak?: { at: number; mark: number; ret: number };
  done: boolean;
}

export interface TrackBucket {
  label: string;
  n: number;
  /** average return and share of winners at each checkpoint (only records that reached it) */
  at: Partial<Record<Checkpoint, { n: number; avg: number; win: number }>>;
  /** share that reached +50% and +100% at some point */
  hit50: number;
  hit100: number;
}

export interface TrackView {
  picks: TrackBucket[];
  signals: TrackBucket[];
  recent: TrackRecord[];
}

export type AlertKind = "verdict" | "signal" | "risk" | "test" | "picks" | "watch";

export interface Alert {
  id: string;
  at: number;
  kind: AlertKind;
  tone: "up" | "down" | "warn" | "neutral";
  title: string;
  body: string;
  /** page to open when the alert is clicked */
  href?: string;
  read: boolean;
}

export interface AlertSettings {
  /** alert when an open position's verdict changes to Take profit, Sell or Trim */
  verdicts: boolean;
  /** alert on new signals at or above this conviction; 0 turns signal alerts off */
  signalMin: number;
  /** alert when today's loss reaches the plan's daily limit */
  risk: boolean;
  /** also push to the phone through ntfy */
  phone: boolean;
  /** morning picks at 9:45 ET */
  picks: boolean;
}

export interface AlertsView {
  alerts: Alert[];
  unread: number;
  settings: AlertSettings;
  /** an ntfy topic is configured in the environment */
  phoneReady: boolean;
  /** last time the watcher ran, ms */
  checkedAt?: number;
  watching: boolean;
}

export interface Provider {
  info: ProviderInfo;
  /** one-minute bars for the most recent session */
  intraday(symbol: string): Promise<Bar[]>;
  /** daily bars, about six months, oldest first */
  daily(symbol: string): Promise<Bar[]>;
  universe(): Promise<{ symbol: string; catalyst?: Catalyst }[]>;
  quotes(symbols: string[]): Promise<Record<string, Quote>>;
  expirations(symbol: string): Promise<string[]>;
  chain(symbol: string, exp: string): Promise<OptionContract[]>;
}
