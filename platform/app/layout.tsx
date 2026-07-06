import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Factory",
  description: "AI video production, supervised by you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="glow g1" />
        <div className="glow g2" />
        <nav className="nav">
          <div className="in">
            <Link href="/" className="brand">
              <span className="mk">▶</span>Video Factory
            </Link>
            <Link href="/" className="navlink on">
              Projects
            </Link>
            <span className="sp" />
            <span className="av">F</span>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
