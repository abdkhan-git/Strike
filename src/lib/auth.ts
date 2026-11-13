/**
 * Sign-in with Google and the session cookie.
 *
 * Sign-in is on when GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_SECRET are all set.
 * Without them the app runs as before, open to whoever can reach the server (fine on
 * localhost, never on a public address).
 *
 * The session is a signed cookie (HMAC-SHA256 over a small JSON payload): httpOnly,
 * SameSite=Lax, 30 days. Web Crypto only, so the same code runs in the proxy and in
 * route handlers.
 */

export const SESSION_COOKIE = "strike_session";
export const OAUTH_COOKIE = "strike_oauth";
const MAX_AGE = 30 * 86_400;

export interface SessionUser {
  /** Google's stable account id */
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export const authEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET);

const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString("base64url");

async function hmac(data: string) {
  const secret = process.env.AUTH_SECRET ?? "";
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time comparison, so a forged signature cannot be found one character at a time. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(user: SessionUser) {
  const body = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  return `${body}.${await hmac(body)}`;
}

export async function readSession(token: string | undefined): Promise<SessionUser | undefined> {
  if (!token || !process.env.AUTH_SECRET) return undefined;
  const [body, sig] = token.split(".");
  if (!body || !sig || !same(sig, await hmac(body))) return undefined;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionUser & { exp: number };
    if (!p.sub || !p.email || !(p.exp > Date.now() / 1000)) return undefined;
    return { sub: p.sub, email: p.email, name: p.name, picture: p.picture };
  } catch {
    return undefined;
  }
}

export const sessionCookie = (value: string, secure: boolean) => ({
  name: SESSION_COOKIE,
  value,
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge: value ? MAX_AGE : 0,
});

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(text: string) {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** Where the app is served from: APP_URL when set, otherwise the address the request came in on. */
export function appOrigin(requestUrl: string) {
  const fixed = process.env.APP_URL?.replace(/\/$/, "");
  return fixed || new URL(requestUrl).origin;
}

/** Only same-site paths are allowed as a post-sign-in destination. */
export const safeNext = (next: string | null | undefined) => (next && /^\/(?!\/)[^\\]*$/.test(next) && !next.startsWith("/api/") ? next : "/");
