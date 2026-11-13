import type { NextRequest } from "next/server";
import { brokerView, connectUrl, syncFromBroker } from "@/lib/broker";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await brokerView());
}

/**
 * `?action=connect` returns a link to SnapTrade's page for connecting a brokerage.
 * `?action=sync` rebuilds the brokerage trades in the log from executed orders right away
 * (every fill ever seen is kept, so the history never shrinks).
 */
export async function POST(req: NextRequest) {
  const action = new URL(req.url).searchParams.get("action");
  try {
    if (action === "sync") return Response.json({ trades: await syncFromBroker(true) });
    return Response.json({ url: await connectUrl() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Brokerage request failed" }, { status: 502 });
  }
}
