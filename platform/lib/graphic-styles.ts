/**
 * Graphic styles — WHICH graphics ride over a film's footage (name tags,
 * place stamps, count-up figures, chapter openings) and in which design.
 *
 * Chosen per film by THEME, not by category (the producer, 2026-09-24): a
 * Story or a Documentary can be about anything. The producer picks one on the
 * brief or in Final touches, or leaves it on "AI picks": the graphic-plan
 * workflow then chooses by the film's theme once the scene texts are
 * approved, and in every case extracts what the graphics SAY — the people,
 * places and figures the narration names (db/port/graphic-styles/).
 *
 * The same five ids live in remotion/src/graphics/styles.ts (the drawing),
 * n8n's Normalize Webhook Input (the brief's pick) and Final Assembly's
 * Caption Colour (the render props). `npm run check:normalize` pins this side.
 *
 * Each category has its own set (2026-09-25): Story and Documentary the
 * news/editorial four, Kids story Storybook / Playful / Everything, Cinematic
 * Film / Neon / Memory — `graphicStylesFor(category)`. Classic is everywhere.
 */

import { normalizeTransitionStyle, type TransitionStyleId } from "@/lib/transition-styles";

export type GraphicStyleId =
  | "classic"
  | "reportage"
  | "editorial"
  | "cinematic"
  | "handwritten"
  | "kidsStorybook"
  | "kidsPlayful"
  | "kidsAll"
  | "cineFilm"
  | "cineNeon"
  | "cineMemory";

export const GRAPHIC_STYLES: { id: GraphicStyleId; label: string; hint: string; categories: string[] }[] = [
  { id: "kidsStorybook", categories: ["kids"], label: "Storybook", hint: "Chapter titles written by hand, each character introduced once in a drawn frame, confetti on the happy ending" },
  { id: "kidsPlayful", categories: ["kids"], label: "Playful", hint: "Speech bubbles, a drawn contour naming a character, stickers on little discoveries, confetti" },
  { id: "kidsAll", categories: ["kids"], label: "Everything", hint: "All of the Storybook and Playful graphics together" },
  { id: "cineFilm", categories: ["cinematic"], label: "Film", hint: "The title over the first shot, typed location slates, 2.39:1 bars, calm chapter titles" },
  { id: "cineNeon", categories: ["cinematic"], label: "Neon", hint: "The same, with chapter titles that tear in on a digital glitch" },
  { id: "cineMemory", categories: ["cinematic"], label: "Memory", hint: "The title, warm light leaks on each chapter change, calm chapter titles" },
  { id: "reportage", categories: ["story", "documentary"], label: "Reportage", hint: "News bars for places and chapters, a side rule for names, figures that count up" },
  { id: "editorial", categories: ["story", "documentary"], label: "Editorial", hint: "Dark cards for names and places, a kicker over each chapter title, figures, a white flash on chapter cuts" },
  { id: "cinematic", categories: ["story", "documentary"], label: "Cinematic", hint: "A large luminous chapter title, slim side rules for names and places" },
  { id: "handwritten", categories: ["story", "documentary"], label: "Handwritten", hint: "Chapter titles written by hand, dark cards for names and places" },
  { id: "classic", categories: ["story", "documentary", "kids", "cinematic"], label: "Classic", hint: "No graphics over the footage — full-screen chapter cards, as before" },
];

/** The categories that offer the choice — every one since 2026-09-25. */
export const GRAPHIC_STYLE_CATEGORIES = ["story", "documentary", "kids", "cinematic"];

const categoryOf = (category: string | null | undefined): string =>
  String(category ?? "story").trim().toLowerCase() || "story";

export const offersGraphicStyle = (category: string | null | undefined): boolean =>
  GRAPHIC_STYLE_CATEGORIES.includes(categoryOf(category));

/** The styles a category offers, Classic last. An unknown category gets Story's. */
export const graphicStylesFor = (category: string | null | undefined) => {
  const c = GRAPHIC_STYLE_CATEGORIES.includes(categoryOf(category)) ? categoryOf(category) : "story";
  return GRAPHIC_STYLES.filter((g) => g.categories.includes(c));
};

/** A known style id, or null. Refuses rather than guesses — a typo must not restyle a film. */
export function normalizeGraphicStyle(value: unknown): GraphicStyleId | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return GRAPHIC_STYLES.some((s) => s.id === v) ? (v as GraphicStyleId) : null;
}

export const graphicStyleLabel = (id: GraphicStyleId | null | undefined): string =>
  GRAPHIC_STYLES.find((s) => s.id === id)?.label ?? "";

export type GraphicPlanItem =
  | { kind: "person" | "place"; sceneOrder: number; title: string; subtitle?: string }
  | { kind: "stat"; sceneOrder: number; value: number; suffix?: string; label: string; caption?: string }
  | { kind: "character"; sceneOrder: number; title: string }
  | { kind: "speech"; sceneOrder: number; text: string }
  | { kind: "moment"; sceneOrder: number; label: string }
  | { kind: "celebrate"; sceneOrder: number }
  | { kind: "slate"; sceneOrder: number; title: string; subtitle?: string };

/** What the graphic-plan workflow wrote into Editing Options.graphicPlan. */
export interface GraphicPlan {
  style: GraphicStyleId;
  /** The transition family the AI chose (lib/transition-styles.ts), when it was asked. */
  transition: TransitionStyleId | null;
  source: "ai" | "producer";
  why: string;
  items: GraphicPlanItem[];
  at: string | null;
}

const str = (v: unknown, n: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Read a stored plan for display. Anything malformed is dropped, never shown half-read. */
export function normalizeGraphicPlan(value: unknown): GraphicPlan | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const style = normalizeGraphicStyle(v.style);
  if (!style) return null;
  const items: GraphicPlanItem[] = [];
  for (const raw of Array.isArray(v.items) ? v.items : []) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const sceneOrder = Number(it.sceneOrder);
    if (!Number.isInteger(sceneOrder) || sceneOrder <= 0) continue;
    if (it.kind === "person" || it.kind === "place") {
      const title = str(it.title, 40);
      if (!title) continue;
      const subtitle = str(it.subtitle, 56);
      items.push({ kind: it.kind, sceneOrder, title, ...(subtitle ? { subtitle } : {}) });
    } else if (it.kind === "stat") {
      const value = Number(it.value);
      const label = str(it.label, 40);
      if (!Number.isFinite(value) || value <= 0 || !label) continue;
      const suffix = str(it.suffix, 3);
      const caption = str(it.caption, 64);
      items.push({ kind: "stat", sceneOrder, value, label, ...(suffix ? { suffix } : {}), ...(caption ? { caption } : {}) });
    } else if (it.kind === "character") {
      const title = str(it.title, 40);
      if (title) items.push({ kind: "character", sceneOrder, title });
    } else if (it.kind === "speech") {
      const text = str(it.text, 60);
      if (text) items.push({ kind: "speech", sceneOrder, text });
    } else if (it.kind === "moment") {
      const label = str(it.label, 24);
      if (label) items.push({ kind: "moment", sceneOrder, label });
    } else if (it.kind === "celebrate") {
      items.push({ kind: "celebrate", sceneOrder });
    } else if (it.kind === "slate") {
      const title = str(it.title, 28);
      const subtitle = str(it.subtitle, 32);
      if (title) items.push({ kind: "slate", sceneOrder, title, ...(subtitle ? { subtitle } : {}) });
    }
  }
  return {
    style,
    transition: normalizeTransitionStyle(v.transition),
    source: v.source === "producer" ? "producer" : "ai",
    why: str(v.why, 240),
    items,
    at: typeof v.at === "string" ? v.at : null,
  };
}
