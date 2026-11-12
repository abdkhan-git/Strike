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

/**
 * Logs every brokerage option position that is not already open in the trade log, at the
 * broker's average cost. Returns how many were added.
 */
export async function importPositions(): Promise<number> {
  const view = await brokerView();
  if (view.error) throw new Error(view.error);
  const trades = await readTrades();
  const open = new Set(trades.filter((t) => t.status === "open").map((t) => t.occ));
  const added: Trade[] = [];
  for (const o of view.options) {
    const occ = occOf(o.ticker);
    if (open.has(occ) || o.qty <= 0 || !o.avgPrice) continue;
    open.add(occ);
    added.push({
      id: crypto.randomUUID(),
      occ,
      underlying: o.underlying,
      type: o.type,
      strike: o.strike,
      expiration: o.expiration,
      qty: o.qty,
      entryPrice: o.avgPrice,
      entryAt: Date.now(),
      status: "open",
      note: "Imported from brokerage",
    });
  }
  if (added.length) await writeTrades([...trades, ...added]);
  return added.length;
}
