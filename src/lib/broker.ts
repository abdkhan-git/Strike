import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import { cached } from "./cache";
import { readTrades, writeTrades } from "./store";
import type { BrokerAccount, BrokerOption, BrokerView, Trade } from "./types";

/**
 * Read-only brokerage link through SnapTrade, using a personal API key (the SnapTrade
 * user comes with the key, so there is nothing to register). Brokerages are connected on
 * SnapTrade's own page; afterwards this reads balances and option positions. It never
 * places orders.
 */

function client() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  return clientId && consumerKey ? new Snaptrade({ auth: SnaptradeAuth.personalApiKey({ clientId, consumerKey }) }) : undefined;
}

const message = (e: unknown) => {
  const body = (e as { responseBody?: { detail?: string; message?: string } })?.responseBody;
  return body?.detail ?? body?.message ?? (e instanceof Error ? e.message : "SnapTrade request failed");
};

/** SnapTrade's v2 endpoints return numbers as strings. */
const num = (x: unknown) => {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Link to SnapTrade's page for connecting another brokerage, read-only. */
export async function connectUrl(): Promise<string> {
  const api = client();
  if (!api) throw new Error("Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to .env.local first");
  try {
    const res = await api.authentication.loginSnapTradeUser({ connectionType: "read" });
    const url = "redirectURI" in res.data ? res.data.redirectURI : undefined;
    if (!url) throw new Error("SnapTrade did not return a connection link");
    return url;
  } catch (e) {
    throw new Error(message(e));
  }
}

type Rec = Record<string, unknown>;

export async function brokerView(): Promise<BrokerView> {
  const api = client();
  if (!api) return { configured: false, linked: false, accounts: [], options: [] };

  try {
    // SnapTrade syncs brokerages every few minutes; asking more often gains nothing
    return await cached("broker", 60_000, async () => {
      const list = (await api.accountInformation.listAllUserAccounts()).data.results as unknown as Rec[];
      const accounts: BrokerAccount[] = [];
      const options: BrokerOption[] = [];
      for (const a of list) {
        const id = String(a.id);
        const [positions, balances] = await Promise.all([
          api.accountInformation.getAllAccountPositions({ accountId: id }).then((r) => r.data.results as unknown as Rec[]),
          api.accountInformation.getAccountBalancesV2({ accountId: id }).then((r) => r.data as unknown as Rec).catch(() => undefined),
        ]);
        const net = (a.net_value ?? balances?.net_value) as Rec | undefined;
        const cash = (balances?.cash as Rec[] | undefined)?.reduce((s, c) => s + (num(c.amount) ?? 0), 0);
        accounts.push({
          id,
          name: String(a.display_name ?? a.masked_account_number ?? "Account"),
          institution: String(a.raw_type ?? a.kind ?? ""),
          total: num(net?.amount),
          currency: net?.currency ? String(net.currency) : undefined,
          cash,
        });
        for (const p of positions) {
          const inst = p.instrument as Rec | undefined;
          if (inst?.kind !== "option") continue;
          const units = num(p.units);
          const strike = num(inst.strike_price);
          if (!units || !strike) continue;
          const ticker = String(inst.symbol);
          options.push({
            accountId: id,
            ticker,
            underlying: String((inst.underlying as Rec | undefined)?.symbol ?? ticker.split(/\s/)[0]),
            type: String(inst.option_type).toLowerCase() === "put" ? "put" : "call",
            strike,
            expiration: String(inst.expiration_date).slice(0, 10),
            qty: units,
            // per-share prices, the same convention as the rest of the app
            avgPrice: num(p.cost_basis),
            price: num(p.price),
          });
        }
      }
      return { configured: true, linked: accounts.length > 0, accounts, options };
    });
  } catch (e) {
    return { configured: true, linked: false, accounts: [], options: [], error: message(e) };
  }
}

/** OCC symbol without the padding spaces brokers add, e.g. "NVDA261113C00175000". */
export const occOf = (ticker: string) => ticker.replace(/\s+/g, "");

type Fill = {
  id: string;
  occ: string;
  underlying: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  at: number;
};

/** Executed option orders from every linked account, oldest first. */
async function fills(api: NonNullable<ReturnType<typeof client>>): Promise<Fill[]> {
  const accounts = (await api.accountInformation.listAllUserAccounts()).data.results as unknown as Rec[];
  const out: Fill[] = [];
  for (const a of accounts) {
    const orders = (await api.accountInformation.getUserAccountOrders({ accountId: String(a.id), state: "executed", days: 365 }))
      .data as unknown as Rec[];
    for (const o of orders) {
      const sym = o.option_symbol as Rec | undefined;
      const qty = num(o.filled_quantity);
      const price = num(o.execution_price);
      const action = String(o.action ?? "");
      if (!sym || !qty || price === undefined || !/^(BUY|SELL)/.test(action)) continue;
      const ticker = String(sym.ticker);
      out.push({
        id: String(o.brokerage_order_id),
        occ: occOf(ticker),
        underlying: String((sym.underlying_symbol as Rec | undefined)?.symbol ?? ticker.split(/\s/)[0]),
        type: String(sym.option_type).toLowerCase() === "put" ? "put" : "call",
        strike: Number(sym.strike_price),
        expiration: String(sym.expiration_date).slice(0, 10),
        side: action.startsWith("BUY") ? "buy" : "sell",
        qty,
        price,
        at: Date.parse(String(o.time_executed ?? o.time_updated ?? o.time_placed)),
      });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

/**
 * Rebuilds the brokerage part of the trade log from executed orders: buys open lots,
 * sells close them first-in-first-out at the real fill price. Lots still open after the
 * last order stay open; expired ones are settled later at intrinsic value and that
 * settlement is kept across syncs.
 */
function rebuild(all: Fill[], previous: Trade[]): Trade[] {
  const prior = new Map(previous.map((t) => [t.id, t]));
  const lots = new Map<string, { fill: Fill; left: number }[]>();
  const out: Trade[] = [];
  const base = (f: Fill) => ({
    occ: f.occ,
    underlying: f.underlying,
    type: f.type,
    strike: f.strike,
    expiration: f.expiration,
    source: "broker" as const,
  });

  for (const f of all) {
    const open = lots.get(f.occ) ?? [];
    lots.set(f.occ, open);
    if (f.side === "buy") {
      open.push({ fill: f, left: f.qty });
      continue;
    }
    let toClose = f.qty;
    while (toClose > 0 && open.length) {
      const lot = open[0];
      const n = Math.min(lot.left, toClose);
      out.push({
        ...base(lot.fill),
        id: `bk:${lot.fill.id}:${f.id}`,
        qty: n,
        entryPrice: lot.fill.price,
        entryAt: lot.fill.at,
        status: "closed",
        exitPrice: f.price,
        exitAt: f.at,
      });
      lot.left -= n;
      toClose -= n;
      if (lot.left <= 0) open.shift();
    }
    // a sell with no buy left in the history window has nothing to match; it is skipped
  }

  for (const open of lots.values())
    for (const lot of open) {
      const id = `bk:${lot.fill.id}`;
      const was = prior.get(id);
      // keep an expiry settlement made on an earlier pass
      if (was?.status === "closed") out.push({ ...was, ...base(lot.fill), qty: lot.left });
      else out.push({ ...base(lot.fill), id, qty: lot.left, entryPrice: lot.fill.price, entryAt: lot.fill.at, status: "open" });
    }
  return out;
}

/**
 * Brings the trade log in line with the brokerage: brokerage trades are replaced by the
 * rebuilt set, trades logged by hand are kept unless the same contract is already
 * covered by brokerage fills. Runs at most once a minute unless forced.
 * Returns how many brokerage trades the log now holds.
 */
export function syncFromBroker(force = false): Promise<number> {
  const api = client();
  if (!api) return Promise.resolve(0);
  if (sync.pending) return sync.pending;
  if (!force && sync.last && Date.now() - sync.at < 60_000) return sync.last;
  sync.at = Date.now();
  sync.pending = (async () => {
    const all = await fills(api);
    if (!all.length) return 0;
    const trades = await readTrades();
    const covered = new Set(all.map((f) => f.occ));
    const manual = trades.filter(
      (t) => t.source !== "broker" && t.note !== "Imported from brokerage" && !(t.status === "open" && covered.has(t.occ)),
    );
    const synced = rebuild(all, trades.filter((t) => t.source === "broker"));
    await writeTrades([...manual, ...synced]);
    return synced.length;
  })().finally(() => {
    sync.pending = undefined;
  });
  sync.last = sync.pending;
  return sync.pending;
}

// on globalThis so the watcher and the routes share one sync schedule
const gs = globalThis as { __strikeSync?: { at: number; last?: Promise<number>; pending?: Promise<number> } };
const sync = (gs.__strikeSync ??= { at: 0 });
