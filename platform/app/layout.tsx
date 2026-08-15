import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, IBM_Plex_Mono, Inter_Tight, Poppins } from "next/font/google";
import ProductionTicker from "@/components/ProductionTicker";
import StaleCopyBanner from "@/components/StaleCopyBanner";
import "./globals.css";

/**
 * One type system, shared with what the pipeline renders.
 *
 * The app used to run on the system stack, which reads as "some dark
 * dashboard". These are the same faces `remotion/src/style.ts` puts on screen
 * in the videos — an editorial serif for display, a tight grotesque for the
 * interface, a mono for small tracked labels. A tool that makes films should
 * look like the films it makes.
 *
 * latin-ext is not optional: project names are written in Romanian, and ș and
 * ț live outside the latin subset. next/font self-hosts the files, so none of
 * this costs a request to Google at runtime.
 */
const display = Fraunces({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--f-display",
  display: "swap",
});

const ui = Inter_Tight({
  subsets: ["latin", "latin-ext"],
  variable: "--f-ui",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--f-mono",
  display: "swap",
});

/**
 * Project titles in the lists, where legibility beats character: at 17-19px a
 * high-contrast serif costs more than it gives, especially on the index rows
 * where a title is one clipped line among a hundred. The display serif still
 * carries section headings and the project page's own title.
 */
const title = Poppins({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600"],
  variable: "--f-title",
  display: "swap",
});

export const metadata: Metadata = {
  title: "House of Videos",
  description: "AI video production, supervised by you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${ui.variable} ${mono.variable} ${title.variable}`}>
        <StaleCopyBanner />
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="vignette" />
        <div className="navfade" />
        <nav className="nav">
          <div className="in">
            {/* The wordmark is the type pairing itself — the brand speaks the
                same grotesque + italic serif the whole app (and the films) do. */}
            <Link href="/" className="brand wm">
              <span className="w1">House</span>
              <span className="w2">of Videos</span>
            </Link>
            <Link href="/" className="navlink on">
              Projects
            </Link>
            <Link href="/admin" className="navlink">
              Settings
            </Link>
            <span className="sp" />
            <ProductionTicker />
            <span className="sp" />
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
