import { promises as fs } from "fs";
import path from "path";
import type { Alert, AlertSettings, Briefing, PlanSettings, Thesis, TrackRecord, Trade } from "./types";
import type { UserAccount } from "./users";

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

/**
 * Written to a temporary file and renamed into place, so a crash or two writers at once
 * can never leave a half-written file behind (a truncated trades.json would read back as
 * "no trades").
 */
async function write(name: string, value: unknown) {
  await fs.mkdir(DIR, { recursive: true });
  const file = path.join(DIR, name);
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  // on Windows a rename can fail for a moment while another request has the file open to read
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt < 6 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw e;
    }
  }
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

/** Every brokerage fill ever seen, so the trade log can always be rebuilt in full. */
export const readFills = <T,>() => read<T[]>("fills.json", []);
export const writeFills = (rows: unknown[]) => write("fills.json", rows);

export const readUsers = () => read<UserAccount[]>("users.json", []);
export const writeUsers = (rows: UserAccount[]) => write("users.json", rows);
