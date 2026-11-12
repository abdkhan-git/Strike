import type { NextRequest } from "next/server";
import { tradeViews } from "@/lib/positions";
import { readTrades, writeTrades } from "@/lib/store";
import type { Trade } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await tradeViews());
}

export async function POST(req: Request) {
  const b = await req.json();
  const qty = Math.floor(Number(b.qty));
  const entryPrice = Number(b.entryPrice);
  if (!b.occ || !b.underlying || !(qty > 0) || !(entryPrice > 0))
    return Response.json({ error: "Quantity and fill price are required" }, { status: 400 });
  const trade: Trade = {
    id: crypto.randomUUID(),
    occ: String(b.occ),
    underlying: String(b.underlying),
    type: b.type === "put" ? "put" : "call",
    strike: Number(b.strike),
    expiration: String(b.expiration),
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
  const b = await req.json();
  const exitPrice = Number(b.exitPrice);
  if (!(exitPrice >= 0)) return Response.json({ error: "Exit price is required" }, { status: 400 });
  const trades = await readTrades();
  const t = trades.find((x) => x.id === b.id);
  if (!t) return Response.json({ error: "Trade not found" }, { status: 404 });
  t.status = "closed";
  t.exitPrice = exitPrice;
  t.exitAt = Date.now();
  await writeTrades(trades);
  return Response.json(t);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const trades = await readTrades();
  await writeTrades(trades.filter((t) => t.id !== id));
  return Response.json({ ok: true });
}
