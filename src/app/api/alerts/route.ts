import type { NextRequest } from "next/server";
import { alertSettings, alertsView, checkNow, markAllRead, sendTest, startWatcher } from "@/lib/alerts";
import { writeAlertSettings } from "@/lib/store";
import type { AlertSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  startWatcher(); // in case the server started before instrumentation existed
  return Response.json(await alertsView());
}

/** `?action=read` marks everything read, `?action=test` sends a test alert, `?action=check` runs the watcher now. */
export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  if (action === "read") await markAllRead();
  else if (action === "test") await sendTest();
  else if (action === "check") await checkNow();
  else return Response.json({ error: "Unknown action" }, { status: 400 });
  return Response.json(await alertsView());
}

export async function PUT(req: Request) {
  const b = await req.json();
  const current = await alertSettings();
  const next: AlertSettings = {
    verdicts: typeof b.verdicts === "boolean" ? b.verdicts : current.verdicts,
    risk: typeof b.risk === "boolean" ? b.risk : current.risk,
    phone: typeof b.phone === "boolean" ? b.phone : current.phone,
    picks: typeof b.picks === "boolean" ? b.picks : current.picks,
    signalMin: Number.isFinite(Number(b.signalMin)) ? Math.min(100, Math.max(0, Math.round(Number(b.signalMin)))) : current.signalMin,
  };
  await writeAlertSettings(next);
  return Response.json(await alertsView());
}
