import { promises as fs } from "fs";
import path from "path";
import type { Alert, AlertSettings, Briefing, PlanSettings, Thesis, TrackRecord, Trade } from "./types";

// Everything the app remembers lives in plain JSON files under data/ (git-ignored),
// so it is easy to inspect and back up.
const DIR = path.join(process.cwd(), "data");

async function read<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

async function write(name: string, value: unknown) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, name), JSON.stringify(value, null, 2));
}

export const readTrades = () => read<Trade[]>("trades.json", []);
export const writeTrades = (trades: Trade[]) => write("trades.json", trades);

export const readPlan = () => read<PlanSettings | null>("plan.json", null);
export const writePlan = (plan: PlanSettings) => write("plan.json", plan);


export const readAlerts = () => read<Alert[]>("alerts.json", []);
export const writeAlerts = (alerts: Alert[]) => write("alerts.json", alerts);

export const readAlertSettings = () => read<AlertSettings | null>("alert-settings.json", null);
export const writeAlertSettings = (s: AlertSettings) => write("alert-settings.json", s);

export const readTrack = () => read<TrackRecord[]>("track.json", []);
export const writeTrack = (rows: TrackRecord[]) => write("track.json", rows);

export const readBriefings = () => read<Briefing[]>("briefings.json", []);
export const writeBriefings = (rows: Briefing[]) => write("briefings.json", rows);

export const readTheses = () => read<Thesis[]>("theses.json", []);
export const writeTheses = (rows: Thesis[]) => write("theses.json", rows);
