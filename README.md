# Strike

Personal options-flow scanner, profit calculator, trade log with live verdicts, and daily plan. Next.js 16 · React 19 · Tailwind 4 · Recharts.

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
| `GEMINI_API_KEY` | Writes news digests and contract notes (optional) |
| `ANTHROPIC_API_KEY` | Fallback writer when Gemini is slow, over quota or fails (optional) |
| `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` | Read-only brokerage balances and option positions, SnapTrade personal key (optional) |
| `GEMINI_MODEL`, `CLAUDE_MODEL` | Override the models; defaults are in `src/lib/ai.ts` |

## Layout

```
src/
  app/
    page.tsx              Scanner: symbols, unusual contracts, signals rail
    s/[symbol]/page.tsx   Price chart, 15-minute read, news, flow and full chain for one ticker
    calculator/page.tsx   Order ticket: live chain, scenario sliders, P/L, log purchase
    positions/page.tsx    Open positions with live verdicts, brokerage panel, history, daily P/L
    plan/page.tsx         Goal pace, risk budget for the next trade, sized setups
    api/                  scan, signals, symbol, chart, news, trades, plan, broker, status
  lib/
    providers/tradier.ts  Live data adapter (rate-limited to 105 requests a minute)
    providers/sim.ts      Simulated data
    market.ts             Provider selection, shared chain cache, scan, signals, symbol view, chart
    analytics.ts          Enrichment: live IV/greeks, flow score, implied move, signal conviction
    outlook.ts            15-minute momentum read and daily trend from price bars
    verdict.ts            Take profit / Sell / Trim / Hold / Wait rules for open positions
    positions.ts          Marks open trades, settles expired ones, attaches verdicts
    plan.ts               Goal pace, risk budget and sized setups
    broker.ts             SnapTrade: balances, option positions, import to the log
    reason.ts             One-line explanation of why a contract stands out (rules, no model)
    cache.ts              TTL cache with shared in-flight loads and stale-while-refresh
    news.ts               Company headlines (Finnhub)
    ai.ts                 JSON generation: Gemini models in order, then Claude
    insights.ts           News digest per symbol and news notes on unusual contracts
    bs.ts                 Black-Scholes pricing, greeks, IV solver
    store.ts              data/trades.json and data/plan.json (git-ignored)
  components/             Shell, ticker tape, command palette (Ctrl K), signals rail, price chart,
                          news panel, UI primitives
```

## How the numbers are made

- **Flow score (0–100):** 40% volume vs open interest, 25% size, 20% spread tightness, 15% closeness to 0.40 delta.
- **IV and greeks:** re-solved from the live bid/ask each refresh; Tradier's hourly greeks are the fallback.
- **Implied odds:** risk-neutral probability the long option is above break-even at expiry.
- **Implied move:** at-the-money straddle price ÷ stock price.
- **Signals:** one expiration per window (today, this week, ~1 month, ~2 months). Conviction (0–100) is 45% how lopsided the call/put premium split is, 25% dominant-side volume vs open interest, 15% dollar size, 15% share of that premium that is out of the money. Shown from 50 up, "Strong" from 70. Live data refreshes every 3 minutes to stay inside Tradier's rate limit.
- **15-minute read:** from one-minute bars: the 5- and 15-minute returns and the distance from VWAP, each scaled by current one-minute volatility, plus a small RSI pull toward the middle. It leans one way past ±0.2 of the blended score. The range is one standard deviation of a 15-minute move. Direction over a few minutes is close to a coin flip; the range is the dependable part.
- **Position verdicts:** fixed rules checked in order. Take profit at +100%, or at +50% when momentum turns or 3 days remain. Sell when expiring out of the money, or down 50% with 5 days or less or under 15% implied odds. Trim before earnings when up 20%+, or when a day of decay exceeds 8% of the position and momentum is not helping. Otherwise hold or wait. Target and stop are +100% and −50% of the entry premium.
- **Expired positions:** closed automatically at intrinsic value, using the stock's close on expiration day.
- **Daily plan:** equity is the live brokerage value when linked, otherwise start + realized + open P/L. Risk per trade is a share of equity, halved after a losing day, halved again after three in a row, and zero once the daily loss limit is hit or every slot is used.
- **Reasoning lines:** assembled from the measured figures (volume vs open interest, where the last trade printed in the bid/ask, the symbol's call/put split, earnings date). No language model is involved.
- **News notes and digests:** a model reads the last three days of headlines and writes one sentence per unusual contract (batched, at most one batch every 3 minutes, each note kept 30 minutes) and a short digest per symbol (kept 20 minutes). Generation runs in the background, so the text appears a poll or two after the page loads. Off on simulated data.
- **Scanner expiry:** first expiry at least a day out that covers the next earnings date.

## Roadmap

- Alerts (desktop / phone) when a verdict changes or a signal crosses a threshold
- Desktop build (Electron or Tauri)
