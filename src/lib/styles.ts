import type { Horizon, PlanStyle } from "./types";

/**
 * Plan styles. Choosing one sets the risk per trade and daily loss limit (both still
 * editable) and decides how many morning picks there are and which expiries they use.
 * More aggressive means bigger, fewer, shorter-dated bets: faster toward the goal when
 * they work, and a bigger hit to the account when they do not.
 */
export const STYLES: Record<
  PlanStyle,
  { label: string; blurb: string; riskPerTrade: number; dailyLossLimit: number; maxOpen: number; picks: number; horizons: Horizon[] }
> = {
  focused: {
    label: "Focused",
    blurb: "One best trade a day, about 75% of the account, 3 to 14 days out",
    riskPerTrade: 0.75,
    dailyLossLimit: 0.4,
    maxOpen: 1,
    picks: 1,
    horizons: ["week", "month"],
  },
  steady: {
    label: "Steady",
    blurb: "5% per trade, 5 picks, 1 week to 2 months out",
    riskPerTrade: 0.05,
    dailyLossLimit: 0.1,
    maxOpen: 5,
    picks: 5,
    horizons: ["week", "month", "quarter"],
  },
  aggressive: {
    label: "Aggressive",
    blurb: "12% per trade, 3 picks, this week to 1 month out",
    riskPerTrade: 0.12,
    dailyLossLimit: 0.2,
    maxOpen: 3,
    picks: 3,
    horizons: ["week", "month"],
  },
  max: {
    label: "All-in",
    blurb: "25% per trade, 2 picks, same-day expiries allowed",
    riskPerTrade: 0.25,
    dailyLossLimit: 0.35,
    maxOpen: 2,
    picks: 2,
    horizons: ["eod", "week"],
  },
};

export const styleOf = (s?: PlanStyle) => STYLES[s ?? "steady"];
