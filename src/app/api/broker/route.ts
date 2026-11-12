import type { NextRequest } from "next/server";
import { brokerView, connectUrl, importPositions } from "@/lib/broker";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await brokerView());
}

/**
 * `?action=connect` returns a link to SnapTrade's page for connecting a brokerage.
 * `?action=import` logs brokerage option positions that are not in the trade log yet.
 */
export async function POST(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("action") === "import") return Response.json({ added: await importPositions() });
    return Response.json({ url: await connectUrl() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Brokerage request failed" }, { status: 502 });
  }
}
