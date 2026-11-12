import { signals } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await signals());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Signals failed" }, { status: 502 });
  }
}
