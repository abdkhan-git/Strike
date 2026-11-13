import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, readSession } from "@/lib/auth";

/**
 * Runs before every page and API request.
 *
 *  1. Host check: the request must be addressed to this machine (localhost, an IP, or the
 *     host in APP_URL / ALLOWED_HOSTS). Stops DNS-rebinding, where a web page points its
 *     own domain at 127.0.0.1 to read a local server.
 *  2. Same-origin check on anything that changes state: another site open in the browser
 *     cannot log, close or delete trades, change the plan or spend AI quota.
 *  3. Sign-in, when Google sign-in is configured: pages redirect to /login, API calls get 401.
 */

const LOCAL = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i;

function hostAllowed(host: string) {
  if (LOCAL.test(host)) return true;
  const extra = [process.env.APP_URL, ...(process.env.ALLOWED_HOSTS ?? "").split(",")]
    .map((h) => (h ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase())
    .filter(Boolean);
  return extra.includes(host.toLowerCase());
}

const PUBLIC = [/^\/login$/, /^\/api\/auth\//];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const host = req.headers.get("host") ?? "";
  if (!hostAllowed(host)) return new NextResponse("Forbidden host", { status: 403 });

  const api = pathname.startsWith("/api/");
  if (api && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const site = req.headers.get("sec-fetch-site");
    let sameOrigin = true;
    if (origin) {
      try {
        sameOrigin = new URL(origin).host === host;
      } catch {
        sameOrigin = false;
      }
    } else if (site) sameOrigin = site === "same-origin" || site === "none";
    if (!sameOrigin) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }

  if (!authEnabled() || PUBLIC.some((p) => p.test(pathname))) return NextResponse.next();

  const user = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();
  if (api) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // everything except Next's own assets and the icon
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
