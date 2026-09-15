import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { IBM_Plex_Mono, Inter, Outfit } from "next/font/google";
import NavMenu from "@/components/NavMenu";
import ProductionTicker from "@/components/ProductionTicker";
import StaleCopyBanner from "@/components/StaleCopyBanner";
import { parseTheme, THEME_COLOR, THEME_COOKIE, themeAttribute } from "@/lib/theme";
import "./globals.css";

/**
 * One type system, shared with what the pipeline renders.
 *
 * These are the same faces `remotion/src/style.ts` puts on screen in the
 * videos — Outfit for display, Inter for the interface, IBM Plex Mono for the
 * small tracked labels that carry structure. A tool that makes films should
 * look like the films it makes, so the two files change together: a face
 * swapped here and not there breaks the whole point.
 *
 * Per-tone display faces (Bodoni for dark, Anton for motivational, Cormorant
 * for emotional, Space Grotesk) still live in lib/tone-type.ts and still
 * mirror presetForTone(). This file sets only the DEFAULT — the face a project
 * wears when its tone does not claim one of its own.
 *
 * latin-ext is not optional: project names are written in Romanian, and ș and
 * ț live outside the latin subset. next/font self-hosts the files, so none of
 * this costs a request to Google at runtime.
 */
const display = Outfit({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600"],
  variable: "--f-display",
  display: "swap",
});

const ui = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--f-ui",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--f-mono",
  display: "swap",
});

/* --f-title (Poppins) is gone. It existed because the display face was a
   high-contrast serif, which costs legibility at the 17-19px a list title is
   SCANNED at rather than read. Outfit is a geometric sans and holds up at that
   size, so its two call sites now use --f-display and the fourth family is one
   less font to load. */

export const metadata: Metadata = {
  title: "House of Videos",
  description: "AI video production, supervised by you.",
};

/**
 * The theme is decided HERE, on the server, from the hov-theme cookie, and
 * arrives as `data-theme` on <html> — so a dark page is dark on its first
 * paint, with no script and no flash. No cookie is Light (the default, by
 * the producer's choice); "system" hands the decision to `color-scheme:
 * light dark` in globals.css, i.e. the device. Reading the cookie makes
 * every route dynamic; every page here already was, and the site sits
 * behind a password anyway. lib/theme.ts owns the rest.
 */
async function currentTheme() {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}

/** The browser's own chrome (the tab strip on a phone) follows the choice. */
export async function generateViewport(): Promise<Viewport> {
  const theme = await currentTheme();
  return {
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
            { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
          ]
        : THEME_COLOR[theme],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await currentTheme();
  return (
    <html lang="en" data-theme={themeAttribute(theme)}>
      <body className={`${display.variable} ${ui.variable} ${mono.variable}`}>
        <StaleCopyBanner />
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="vignette" />
        <div className="navfade" />
        <nav className="nav">
          <div className="in">
            {/* The wordmark used to BE the type pairing — "House" in the
                grotesque, "of Videos" in the display face's italic. Outfit has
                no italic, and asking for one makes the browser synthesise an
                oblique by shearing the roman, which is the same fake-styling
                trap as a synthesised bold. The mark carries the identity
                instead: a circle split on the diagonal, accent against ink. */}
            <Link href="/" className="brand wm">
              <span className="bmark" aria-hidden="true" />
              <span className="w1">House of Videos</span>
            </Link>
            <Link href="/projects" className="navlink on">
              Projects
            </Link>
            <Link href="/admin/footage" className="navlink">
              Footage
            </Link>
            <Link href="/admin" className="navlink">
              Settings
            </Link>
            <span className="sp" />
            <ProductionTicker />
            <span className="sp" />
            {/* Phone only (the module hides it above 720px): the three
                section links above fold behind one button there, because
                brand + "New video" already fill the pill at 390px. */}
            <NavMenu />
            <Link href="/new" className="btn gold navcta">
              New video
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
