/**
 * Text helpers shared by the adapters: provider descriptions arrive as HTML,
 * dates as free text, and the years an asset MENTIONS are the closest thing
 * to a period its metadata offers (see `dateOriginal` in types.ts for why the
 * date field itself cannot be trusted).
 */

/** HTML → plain text: tags out, entities decoded, whitespace collapsed. */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = String(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|tr)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/**
 * Every plausible year in a text, ascending and de-duplicated.
 *
 * Bounded to 1800..next year: a serial number or a file size would otherwise
 * read as a date, and anything before photography is not a year an archive
 * asset was made in — though it may well be one the asset DEPICTS, which is
 * exactly the replica trap the caller has to keep in mind.
 */
export function yearsIn(...texts: Array<string | null | undefined>): number[] {
  const max = new Date().getUTCFullYear() + 1;
  const out = new Set<number>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of String(t).matchAll(/(?<![\d])(1[89]\d\d|20\d\d)(?![\d])/g)) {
      const y = Number(m[1]);
      if (y >= 1800 && y <= max) out.add(y);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** One lower-cased line for the library's own search. */
export function searchable(...parts: Array<string | string[] | null | undefined>): string {
  return parts
    .flat()
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

/**
 * 0..1 from what the file can give a 1280×720 (or 720×1280) canvas.
 *
 * Not relevance — that is a human's call, or a model's in a later slice. A
 * still is scored on its longer side because it can be cropped either way; a
 * video also on length, since a two-second clip cannot carry an eight-second
 * scene without a freeze.
 */
export function qualityScoreOf(
  width: number | null,
  height: number | null,
  durationSeconds: number | null,
  mediaType: "video" | "image",
): number {
  const long = Math.max(width ?? 0, height ?? 0);
  let q = long >= 1920 ? 1 : long >= 1280 ? 0.85 : long >= 960 ? 0.65 : long >= 640 ? 0.4 : 0.2;
  if (mediaType === "video") {
    const d = durationSeconds ?? 0;
    if (d < 3) q *= 0.3;
    else if (d < 8) q *= 0.7;
  }
  return Math.round(q * 100) / 100;
}
