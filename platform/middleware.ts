import { NextResponse, type NextRequest } from "next/server";

// Shared-password gate. Set SITE_PASSWORD to lock the site; leave unset
// to keep it open (e.g. on preview deployments). Replaced by Supabase
// Google login in Phase D.
export function middleware(req: NextRequest) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return NextResponse.next();
  if (req.nextUrl.pathname === "/login") return NextResponse.next();
  // n8n posts generated assets here from inside the compose network. It has no
  // browser session, so the password gate would bounce it to /login and the
  // image would be lost with a 200 nobody looks at. The route authenticates
  // itself with MEDIA_INGEST_KEY instead.
  if (req.nextUrl.pathname === "/api/media/ingest") return NextResponse.next();
  // Same reasoning for the Airtable-shaped shim the workflows call: no browser
  // session, its own shared secret, and a redirect to /login would answer 200
  // with an HTML page that every one of those nodes would happily parse as a
  // record.
  if (req.nextUrl.pathname.startsWith("/api/at/")) return NextResponse.next();
  if (req.cookies.get("vf_auth")?.value === expected) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
