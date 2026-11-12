import type { NextRequest } from "next/server";
import { analyze } from "@/lib/thesis";

export const dynamic = "force-dynamic";

/** The full multi-factor read for one symbol. */
export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return Response.json({ error: "Invalid symbol" }, { status: 400 });
  const a = await analyze(symbol).catch((e) => ({ error: e instanceof Error ? e.message : "Analysis failed" }));
  if (!a) return Response.json({ error: `Not enough data for ${symbol}` }, { status: 404 });
  return Response.json(a);
}
