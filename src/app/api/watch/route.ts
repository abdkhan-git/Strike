import type { NextRequest } from "next/server";
import { checkAll } from "@/lib/check";
import { marketContext } from "@/lib/context";
import type { Idea } from "@/lib/desk";
import { readWatch, writeWatch } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_IDEAS = 12;
const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** The watchlist with a live judgement of every idea, plus the market backdrop. */
export async function GET() {
  try {
    const [checks, context] = await Promise.all([checkAll(await readWatch()), marketContext().catch(() => undefined)]);
    return Response.json({ checks, context });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Could not check the watchlist", 502);
  }
}

/** Add an idea: { symbol, type, strike, expiration, dollars } */
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Send the idea as JSON");
  const symbol = String(b.symbol ?? "").toUpperCase();
  const strike = Number(b.strike);
  const dollars = Number(b.dollars);
  const expiration = String(b.expiration ?? "");
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return bad("Enter a ticker");
  if (!(strike > 0 && strike < 1_000_000)) return bad("Pick a strike");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) return bad("Pick an expiration");
  if (!(dollars >= 1 && dollars <= 10_000_000)) return bad("Enter how many dollars you want to put on it");
  const type = b.type === "put" ? "put" : "call";

  const ideas = await readWatch();
  const same = ideas.find((i) => i.symbol === symbol && i.type === type && i.strike === strike && i.expiration === expiration);
  if (same) {
    same.dollars = dollars;
    await writeWatch(ideas);
    return Response.json(same);
  }
  if (ideas.length >= MAX_IDEAS) return bad(`The watchlist holds ${MAX_IDEAS} ideas. Remove one first.`, 409);
  const idea: Idea = { id: crypto.randomUUID(), symbol, type, strike, expiration, dollars, createdAt: Date.now() };
  await writeWatch([idea, ...ideas]);
  return Response.json(idea, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return bad("Which idea?");
  const ideas = await readWatch();
  await writeWatch(ideas.filter((i) => i.id !== id));
  return Response.json({ ok: true });
}
