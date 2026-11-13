import type { NextRequest } from "next/server";
import { tradeViews } from "@/lib/positions";
import { readTrades, writeTrades } from "@/lib/store";
import type { Trade } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await tradeViews());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not load positions" }, { status: 502 });
  }
}

const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** Log a purchase by hand. Every field is checked: this file is the record the plan and the calls are built on. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Send the trade as JSON");
  const qty = Math.floor(Number(b.qty));
  const entryPrice = Number(b.entryPrice);
  const strike = Number(b.strike);
  const occ = String(b.occ ?? "");
  const underlying = String(b.underlying ?? "").toUpperCase();
  const expiration = String(b.expiration ?? "");
  if (!(qty >= 1 && qty <= 10_000) || !(entryPrice > 0 && entryPrice < 100_000)) return bad("Quantity and fill price are required");
  if (!/^[A-Z.]{1,6}$/.test(underlying) || !/^[A-Z0-9.]{8,24}$/.test(occ) || !/^\d{4}-\d{2}-\d{2}$/.test(expiration) || !(strike > 0))
    return bad("That contract could not be read. Pick it again from the chain.");
  const trade: Trade = {
    id: crypto.randomUUID(),
    occ,
    underlying,
    type: b.type === "put" ? "put" : "call",
    strike,
    expiration,
    qty,
    entryPrice,
    entryAt: Date.now(),
    status: "open",
    note: b.note ? String(b.note).slice(0, 280) : undefined,
  };
  await writeTrades([...(await readTrades()), trade]);
  return Response.json(trade, { status: 201 });
}

/** Close a position: { id, exitPrice } */
export async function PATCH(req: Request) {
  const b = await req.json().catch(() => null);
  const exitPrice = Number(b?.exitPrice);
  if (!b || !(exitPrice >= 0 && exitPrice < 100_000)) return bad("Exit price is required");
  const trades = await readTrades();
  const t = trades.find((x) => x.id === b.id);
  if (!t) return bad("Trade not found", 404);
  if (t.status === "closed") return bad("That position is already closed", 409);
  t.status = "closed";
  t.exitPrice = exitPrice;
  t.exitAt = Date.now();
  await writeTrades(trades);
  return Response.json(t);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return bad("Which trade?");
  const trades = await readTrades();
  if (!trades.some((t) => t.id === id)) return bad("Trade not found", 404);
  await writeTrades(trades.filter((t) => t.id !== id));
  return Response.json({ ok: true });
}
