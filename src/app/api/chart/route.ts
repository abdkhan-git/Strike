import type { NextRequest } from "next/server";
import { chartOf } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return Response.json({ error: "Invalid symbol" }, { status: 400 });
  try {
    return Response.json(await chartOf(symbol));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Chart lookup failed" }, { status: 502 });
  }
}
