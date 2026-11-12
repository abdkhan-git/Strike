import { currentPlan } from "@/lib/plan";
import { writePlan } from "@/lib/store";
import type { PlanSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await currentPlan());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not build the plan" }, { status: 502 });
  }
}

/** Replace the plan settings. */
export async function PUT(req: Request) {
  const b = await req.json();
  const n = (x: unknown) => Number(x);
  const date = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : "");
  const plan: PlanSettings = {
    startCapital: n(b.startCapital),
    goal: n(b.goal),
    startDate: date(b.startDate),
    targetDate: date(b.targetDate),
    riskPerTrade: n(b.riskPerTrade),
    dailyLossLimit: n(b.dailyLossLimit),
    maxOpen: Math.floor(n(b.maxOpen)),
    style: ["focused", "aggressive", "max"].includes(b.style) ? b.style : "steady",
  };
  if (!(plan.startCapital > 0) || !(plan.goal > 0) || !plan.startDate || !plan.targetDate || plan.targetDate <= plan.startDate)
    return Response.json({ error: "Enter a starting amount, a goal and a target date after the start date" }, { status: 400 });
  if (!(plan.riskPerTrade > 0 && plan.riskPerTrade <= 0.9) || !(plan.dailyLossLimit > 0 && plan.dailyLossLimit <= 1) || !(plan.maxOpen >= 1))
    return Response.json({ error: "Risk per trade must be 0–90%, the daily limit 0–100%, and at least one position slot" }, { status: 400 });
  await writePlan(plan);
  return Response.json(plan);
}
