import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

// One family, used for everything: a variable grotesque with deliberate
// irregularities in its curves, so it carries character at display size and
// still sets small text cleanly. Not Inter, not Geist, and not a neutral
// system stack — the hero's only voice.
//
// `latin-ext` is not optional here: the copy is Romanian, and without it
// "temă" and "platformă" fall back mid-word to a different face.
//
// next/font downloads it at BUILD time and self-hosts the result into
// .next/static, which the Dockerfile copies. Nothing is fetched from Google
// at runtime, so the hero adds no third-party request and no layout shift.
// No `weight`, because it is a variable font: one file carries 400 through
// 800, and next/font splits it by SUBSET rather than by weight (asking for
// three weights produced byte-identical output, so the axis costs nothing).
//
// The subsets are what cost: latin plus latin-ext is ~60 kB on the wire, and
// adding it moved simulated-4G LCP from 1.77 s to 2.23 s — it competes with
// the poster for the same narrow pipe. Still inside the 2.5 s budget, but
// that is where the headroom went, and dropping latin-ext is not the lever:
// the copy is Romanian.
const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Scroll hero prototype",
  description: "Canvas frame-sequence hero scrubbed by scroll position.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
