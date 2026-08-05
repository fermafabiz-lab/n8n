import { Anton, Bodoni_Moda, Cormorant_Garamond, Space_Grotesk } from "next/font/google";

/**
 * Tone → the film's own display face, mirrored from remotion/src/style.ts.
 *
 * The site sets project titles in the same typeface the video will use for
 * its hook and chapter cards — a Dark project wears Bodoni, an Emotional one
 * Cormorant. The page dresses itself in the film it is producing. Keep this
 * map in lockstep with presetForTone() in the render; a tone routed to one
 * face here and another there breaks the whole point.
 *
 * Fraunces (epic/documentary/dramatic) is NOT loaded here — it is already the
 * app-wide display font from layout.tsx, so those tones simply inherit
 * var(--f-display) by returning no className.
 *
 * latin-ext everywhere: Romanian titles carry ș and ț.
 */
const bodoni = Bodoni_Moda({
  subsets: ["latin", "latin-ext"],
  weight: ["700"],
  display: "swap",
});
const cormorant = Cormorant_Garamond({
  subsets: ["latin", "latin-ext"],
  weight: ["600"],
  display: "swap",
});
const grotesk = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["700"],
  display: "swap",
});
// Anton has exactly one weight; asking for more makes browsers fake-bold it.
const anton = Anton({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  display: "swap",
});

export interface ToneType {
  /** next/font class carrying family+weight; empty = inherit Fraunces. */
  className: string;
  /** The render uppercases dark/epic/motivational titles — so do we. */
  uppercase: boolean;
}

export function toneType(tone: string | null | undefined): ToneType {
  const k = (tone || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (/dark|horror|conspiracy/.test(k)) return { className: bodoni.className, uppercase: true };
  if (/epic|documentary|dramatic/.test(k)) return { className: "", uppercase: true };
  if (/motivational/.test(k)) return { className: anton.className, uppercase: true };
  if (/educativ|educational|corporate/.test(k)) return { className: grotesk.className, uppercase: false };
  return { className: cormorant.className, uppercase: false };
}
