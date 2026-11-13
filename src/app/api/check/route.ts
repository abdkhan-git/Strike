import type { NextRequest } from "next/server";
import { checkContract } from "@/lib/check";

export const dynamic = "force-dynamic";

/** The live verdict on one contract at a dollar size, without putting it on the watchlist. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const symbol = (p.get("symbol") ?? "").toUpperCase();
  const strike = Number(p.get("strike"));
  const dollars = Number(p.get("dollars"));
  const expiration = p.get("exp") ?? "";
  if (!/^[A-Z.]{1,6}$/.test(symbol) || !(strike > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(expiration) || !(dollars >= 1 && dollars <= 10_000_000))
    return Response.json({ error: "Invalid contract" }, { status: 400 });
  try {
    const type = p.get("type") === "put" ? "put" : "call";
    return Response.json(await checkContract({ id: "adhoc", symbol, type, strike, expiration, dollars, createdAt: Date.now() }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not check this contract" }, { status: 502 });
  }
}
