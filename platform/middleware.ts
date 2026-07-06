import { NextResponse, type NextRequest } from "next/server";

// Shared-password gate. Set SITE_PASSWORD to lock the site; leave unset
// to keep it open (e.g. on preview deployments). Replaced by Supabase
// Google login in Phase D.
export function middleware(req: NextRequest) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return NextResponse.next();
  if (req.nextUrl.pathname === "/login") return NextResponse.next();
  if (req.cookies.get("vf_auth")?.value === expected) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
