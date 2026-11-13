# Strike

Personal options-flow scanner, profit calculator, trade log with live verdicts, and daily plan. Next.js 16 · React 19 · Tailwind 4 · Motion · TradingView Lightweight Charts · Recharts.

Dark by default; light (white page, black charts) from the toggle in the top bar or `?theme=light`. Ctrl K searches tickers, Ctrl J opens Ask Strike.

> Flow scores, verdicts, the 15-minute read and "implied odds" are statistics and fixed rules over market data, not predictions or financial advice.

## Run

```bash
npm install
cp .env.example .env.local   # then add your keys
npm run dev                  # http://localhost:3000
```

Without `TRADIER_TOKEN` the app runs on **simulated** data (amber label in the header).

| Variable | Purpose |
| --- | --- |
| `TRADIER_TOKEN` | Quotes, option chains, greeks, price bars |
| `TRADIER_ENV` | `live` (production token, real-time) or `sandbox` (15-min delayed) |
| `FINNHUB_API_KEY` | Earnings calendar and company headlines (optional) |
| `GEMINI_API_KEY` | Free Gemini models: picks judge, chat, news digests and notes (optional) |
| `GEMINI_PAID_API_KEY` | Billing-enabled Gemini key, used only after the free models run out (optional) |
| `ANTHROPIC_API_KEY` | Last-resort fallback when no Gemini model answers (optional); `CLAUDE_FALLBACK=off` disables it |
| `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` | Read-only brokerage balances and option positions, SnapTrade personal key (optional) |
| `NTFY_TOPIC` | Phone push for alerts through the ntfy app; subscribe to this topic (optional) |
| `GEMINI_MODEL`, `CLAUDE_MODEL` | Override the news-note models; defaults are in `src/lib/ai.ts` |
| `CLAUDE_CHAT_MODEL` | Override the Ask Strike model (default `claude-opus-5-5`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` | Google sign-in. On when all three are set; redirect URI `http://localhost:3000/api/auth/callback` (optional) |
| `ALLOWED_EMAILS` | Comma-separated emails allowed to sign in. Default: only the first account to sign in (the owner) |
| `APP_URL`, `ALLOWED_HOSTS` | Public address and extra host names when the app is not on localhost |

## Security

- `src/proxy.ts` runs before every request: it refuses hosts other than localhost, an IP, `APP_URL` or `ALLOWED_HOSTS` (DNS rebinding), refuses state-changing API calls from another origin (CSRF), and, when Google sign-in is configured, sends pages to `/login` and answers API calls with 401.
- Sign-in is Google's authorization-code flow with PKCE and a one-time state. The session is an HMAC-signed, httpOnly, SameSite=Lax cookie (30 days). Accounts are kept in `data/users.json`.
- The trade log, plan and brokerage link are one shared set of data. Until data is separated per account, only the owner (or `ALLOWED_EMAILS`) can sign in.
- Files under `data/` are written to a temporary file and renamed into place, so a crash cannot leave a half-written trade log.
- `POST /api/picks?action=preview` runs the whole picks pipeline and saves nothing: use it to check the pipeline without touching the track record.

## Layout

```
src/
  app/
    page.tsx              Scanner: symbols, unusual contracts, signals rail
    s/[symbol]/page.tsx   Price chart, 15-minute read, news, flow and full chain for one ticker
    calculator/page.tsx   Order ticket: live chain, scenario sliders, P/L, log purchase
    positions/page.tsx    Open positions with direct calls, call summary, brokerage panel, what's-working breakdown, history
    plan/page.tsx         Goal pace, plan style, today's picks with live calls, track record (/picks redirects here)
    api/                  scan, signals, symbol, chart, news, trades, plan, broker, alerts, picks, chat, status
  instrumentation.ts      Starts the alert watcher when the server boots
  lib/
    providers/tradier.ts  Live data adapter (rate-limited to 105 requests a minute)
    providers/sim.ts      Simulated data
    market.ts             Provider selection, shared chain cache, scan, signals, symbol view, chart
    analytics.ts          Enrichment: live IV/greeks, flow score, implied move, signal conviction
    outlook.ts            15-minute momentum read and daily trend from price bars
    thesis.ts             Full analysis: trend, momentum, RSI, MACD, candles, intraday, flow, market, reversal signs
    verdict.ts            Take profit / Sell / Trim / Hold / Wait rules for open positions
    positions.ts          Marks open trades, settles expired ones, attaches verdicts
    plan.ts               Goal pace, risk budget and sized setups
    alerts.ts             Background watcher: position calls, signals, loss limit, morning picks; ntfy push
    picks.ts              Morning picks: rank the day's setups and size them to the plan
    track.ts              Track record: score picks and signals at 1h, close, next day, expiry
    instruction.ts        Exact order for a contract: size, limit, when, target, stop, sell-by
    styles.ts             Plan styles: Steady, Aggressive, All-in
    assistant.ts          Ask Strike: Claude with read-only tools over the app's live data
    session.ts            Market session from the clock
    broker.ts             SnapTrade: balances, option positions, and the trade log rebuilt from executed orders
    reason.ts             One-line explanation of why a contract stands out (rules, no model)
    cache.ts              TTL cache with shared in-flight loads and stale-while-refresh
    news.ts               Company headlines (Finnhub)
    ai.ts                 Every AI call: free Gemini models, paid Gemini, then Claude; per-model quota tracking
    insights.ts           News digest per symbol and news notes on unusual contracts
    bs.ts                 Black-Scholes pricing, greeks, IV solver
    store.ts              JSON files under data/ (git-ignored): trades, fills, plan, theses, picks, alerts
  components/             Shell (centred nav), alert bell, ticker tape, command palette, chat, toasts, theme toggle,
                          candlestick chart, analysis gauge, signals rail,
                          news panel, UI primitives
```

## How the numbers are made

- **Flow score (0–100):** 40% volume vs open interest, 25% size, 20% spread tightness, 15% closeness to 0.40 delta.
- **IV and greeks:** re-solved from the live bid/ask each refresh; Tradier's hourly greeks are the fallback.
- **Implied odds:** risk-neutral probability the long option is above break-even at expiry.
- **Implied move:** at-the-money straddle price ÷ stock price.
- **Signals:** one expiration per window (today, this week, ~1 month, ~2 months). Conviction (0–100) is 45% how lopsided the call/put premium split is, 25% dominant-side volume vs open interest, 15% dollar size, 15% share of that premium that is out of the money. Shown from 50 up, "Strong" from 70. Live data refreshes every 3 minutes to stay inside Tradier's rate limit.
- **15-minute read:** from one-minute bars: the 5- and 15-minute returns and the distance from VWAP, each scaled by current one-minute volatility, plus a small RSI pull toward the middle. It leans one way past ±0.2 of the blended score. The range is one standard deviation of a 15-minute move. Direction over a few minutes is close to a coin flip; the range is the dependable part.
- **Exact instructions:** every recommendation (signals, unusual contracts, the symbol page's "The trade", picks, plan setups, the calculator) is written as one order from `src/lib/instruction.ts`: quantity sized to the plan's risk per trade, a limit a quarter of the way from mid to ask, when to place it (now during the session, otherwise at the next open), a profit target, a stop and a sell-by time. Exits by expiry: same day +40% / −30% / out by 3:30 pm (the code had this stop at −70% until 2026-11-13); up to 8 days +75% / −50% / hold at most 2 trading days and never past 2 pm on expiry day; up to 45 days +100% / −50% / 10 trading days or 2 weeks before expiry; longer +100% / −50% / 15 trading days or a month before expiry. Open positions use the same exits, chosen by the time to expiry when they were bought, and show the exact order to place ("Sell 2 of 4 now at a limit of …").
- **Position calls:** judged against the trade's thesis. Hard exits show at once: the profit target, the stop, the stock crossing the invalidation price, or the sell-by time. Judgement exits must hold for 90 seconds before the call changes: the full analysis turning clearly against the position (−35 or worse on its side), strong reversal warnings while up 25%+, or earnings tomorrow while up 20%+. Otherwise the position is kept, including through dips that stay on the right side of the invalidation price. Short-term momentum never causes a sell. Positions opened outside the picks get a thesis from the full analysis the first time they are seen.
- **Brokerage sync:** once a minute (and on "Sync now") the brokerage part of the log is rebuilt from the last year of executed option orders: buys open lots, sells close them first-in-first-out at the real fill price. Trades logged by hand are kept unless the same contract appears in the brokerage fills.
- **Expired positions:** closed automatically at intrinsic value, using the stock's close on expiration day.
- **Daily plan:** equity is the live brokerage value when linked, otherwise start + realized + open P/L. Risk per trade is a share of equity, halved after a losing day, halved again after three in a row, and zero once the daily loss limit is hit or every slot is used. The loss limit is measured against the account's value that morning and counts unrealized losses on positions opened today. Days are New York calendar days; exchange holidays through 2027 are in `src/lib/session.ts`.
- **Goal:** the Plan page shows progress against a steady compounding path from start to goal, what that path asks of today and this week in dollars, and a month calendar of realized P/L. The goal never changes trade size or the bar for evidence; the picks judge is told so explicitly.
- **Trade check (Watch page, `src/lib/check.ts`):** any contract you queue is judged every 5 seconds by fixed rules, no model: direction (full analysis ±30 on the trade's side), 15-minute momentum (decisive for same-day expiries), option flow, reversal risk, break-even against a normal move for the time left, decay per hour or day, implied against realized volatility, the spread and what a market order gives away, timing (session, time left, earnings, scheduled events) and size against the plan. Skip when a disqualifying check fails or the score is under 45; Go only when nothing fails, the score is 70+, and the direction check itself passes (plus momentum for same-day). The watcher alerts when a queued idea turns Go.
- **Market context (`src/lib/context.ts`):** SPY regime from the full analysis, SPY implied against 20-day realized volatility, and a calendar: Fed days (listed by hand, 2026 only), jobs report (first Friday) and monthly expiry (third Friday) by their usual rule, earnings from the scan. CPI is not listed. The picks judge receives this context.
- **Paper lab (`src/lib/paper.ts`):** every pick is bought on paper at the ask in the sized quantity and closed by the exit rules (target, stop, invalidation, sell-by, expiry), sampled once a minute by the watcher. Stored in `data/paper.json`.
- **Odds of the goal (Lab page):** 3,000 simulated runs of the remaining trading days at a chosen win rate, payoff and size: chance of reaching the goal, chance of losing half on the way, typical finish.
- **Exposure (Positions page):** dollars gained or lost per 1% move in each stock (delta), daily decay, and a warning when every position leans the same way.
- **Affordable picks:** a pick's single contract must cost no more than the plan's risk per trade. Deltas 0.40–0.65 are preferred, 0.30–0.40 allowed when nothing closer fits; a name with nothing affordable is dropped and listed in the notes. A model-set invalidation closer than 0.3 or further than 3.5 daily ranges (ATR) from the price is replaced by the support/resistance level.
- **Alerts:** a watcher started from `src/instrumentation.ts` runs once a minute from 4:00 to 20:00 ET on weekdays. It alerts when an open position's verdict changes to Take profit, Sell or Trim, when a signal at or above the chosen conviction (default 80) appears for the first time that day, and once when the daily loss limit is hit. The first pass after a restart only records the current state. Alerts are kept in `data/alerts.json` (last 200), shown under the bell, sent as desktop notifications while a Strike tab is open, and pushed to the phone through ntfy when `NTFY_TOPIC` is set.
- **Plan styles:** Focused (one trade a day, 75% of the account, 40% loss limit, 3 to 45 days out), Steady (5% per trade, 10% daily loss limit, 5 picks, 1 week to 2 months out), Aggressive (12%, 20%, 3 picks, this week to 1 month), All-in (25%, 35%, 2 picks, same-day expiries allowed). Choosing one rewrites risk per trade, the loss limit and position slots, and re-ranks the picks.
- **AI order:** every AI call tries the free Gemini models first (each has its own daily quota; a model that runs out is skipped until the quota resets at midnight Pacific, an overloaded one is retried once and then skipped for two minutes), then the same models on `GEMINI_PAID_API_KEY`, then Claude. When nothing answers, picks fall back to a rule-based choice and the news falls back to the rule-written lines.
- **Full analysis (`thesis.ts`):** each factor scored −1..+1 and weighted: trend from the 20/50-day averages and their slope (16%), 5-day momentum scaled by normal volatility (10%), 14-day RSI (6%), MACD histogram sign and direction (8%), daily candlestick patterns such as engulfing, hammer, shooting star, three rising or falling sessions and held gaps (8%), intraday structure on 5-minute bars against VWAP (10%), options flow across all horizons with same-day flow down-weighted (20%), and the market plus relative strength against SPY (10%). Total −100..+100. Separately it looks for reversal signs against the current direction: RSI divergence at a 10-day extreme, fading MACD while price still pushes, overbought or oversold far from the 20-day average, a volume climax with a long wick, and a failed intraday breakout or breakdown.
- **Morning picks:** at 9:45 ET on weekdays (and every 30 minutes until 3:30): symbols with one-sided flow in the style's expiries are run through the full analysis; finalists need a score of at least ±30, option flow on the same side and reversal risk under 0.5. For each finalist two expiries and liquid contracts with deltas 0.40–0.65 are built. An AI judge (Gemini first) chooses up to the style's number of trades, or none, writes the thesis and the risks, and sets the invalidation price: the stock level that proves the trade wrong. The thesis is stored and the position is judged against it after you buy.
- **Track record:** every pick and every signal at conviction 70+ (first time it appears each day) is recorded at its ask and scored on the same contract's mid one hour later, at that day's close, at the next weekday's close and at expiry (intrinsic value at the closing price). The best mid seen in between is sampled every few minutes. Stored in `data/track.json`.
- **Ask Strike:** a chat panel (top bar) backed by Claude Opus 5.5 with tools for the account and open positions, quotes and momentum, option chains, flow, news, the market's strongest signals and today's picks, and `size_order`, which returns the exact instruction plus the position's P/L if the stock moves −2%..+2% by +30 minutes, the close and the sell-by time. It is told to lead with one exact order, take every number from the tools, size to what you say you'll risk, and state the odds and maximum loss in one line. It cannot place orders. History stays in the browser.
- **Reasoning lines:** assembled from the measured figures (volume vs open interest, where the last trade printed in the bid/ask, the symbol's call/put split, earnings date). No language model is involved.
- **News notes and digests:** a model reads the last three days of headlines and writes one sentence per unusual contract (batched, at most one batch every 3 minutes, each note kept 30 minutes) and a short digest per symbol (kept 20 minutes). Generation runs in the background, so the text appears a poll or two after the page loads. Off on simulated data.
- **Scanner expiry:** first expiry at least a day out that covers the next earnings date.

## Roadmap

- Desktop build (Electron or Tauri)
