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
  /** option price at which the +100% target and the -50% stop sit */
  target: number;
  stop: number;
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
}

/** A sized trade candidate for today, taken from the strongest signals. */
export interface PlanIdea {
  symbol: string;
  direction: "bullish" | "bearish";
  horizon: Horizon;
  conviction: number;
  contract: Pick<Enriched, "occ" | "underlying" | "type" | "strike" | "expiration" | "ask" | "mid" | "pop" | "breakeven">;
  qty: number;
  cost: number;
  why: string;
}

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
  todayPnl: number;
  lastDayPnl?: number;
  losingStreak: number;
  openCount: number;
  /** dollars to risk on the next trade, after the adjustments in `notes` */
  budget: number;
  /** why today's budget is what it is, and anything else the day's rules say */
  notes: string[];
  halted: boolean;
  ideas: PlanIdea[];
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

export type AlertKind = "verdict" | "signal" | "risk" | "test";

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
