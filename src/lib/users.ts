import type { SessionUser } from "./auth";
import { readUsers, writeUsers } from "./store";

export interface UserAccount extends SessionUser {
  role: "owner" | "member";
  createdAt: number;
  lastSeenAt: number;
}

/**
 * Creates or updates the account for a Google user and says whether they may come in.
 *
 * Who is allowed: the emails in ALLOWED_EMAILS (comma-separated) when it is set; otherwise
 * the first account to sign in becomes the owner and nobody else is admitted. The trade
 * log, plan and brokerage link are one shared set of data today, so access stays limited
 * to people the owner has named.
 */
export async function admitUser(user: SessionUser): Promise<UserAccount | undefined> {
  const users = await readUsers();
  const allow = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const existing = users.find((u) => u.sub === user.sub);
  const owner = users.find((u) => u.role === "owner");
  const allowed = allow.length ? allow.includes(user.email) : !owner || owner.sub === user.sub;
  if (!allowed) return undefined;

  const now = Date.now();
  const account: UserAccount = existing
    ? { ...existing, ...user, lastSeenAt: now }
    : { ...user, role: owner ? "member" : "owner", createdAt: now, lastSeenAt: now };
  await writeUsers([...users.filter((u) => u.sub !== user.sub), account]);
  return account;
}
