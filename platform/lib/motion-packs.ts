/**
 * Motion packs — how a film's graphics MOVE (captions, chapter titles).
 *
 * The render owns the drawing (remotion/src/motion/packs.ts); this file owns
 * what the producer can pick and what a film gets when nobody picks. The two
 * must agree on the four ids and on the category defaults — so must n8n's
 * `Normalize Webhook Input` (which stores the brief's pick) and Final
 * Assembly's `Caption Colour` node (which hands it to the render).
 * `npm run check:normalize` pins this side, `npm run check:motion` the render's.
 *
 * Stored as `Editing Options.motionPack` only when a film has an explicit
 * pick. Absent means "the category's default", decided at render time, so
 * changing a default later reaches every film that never chose.
 */

export type MotionPackId = "classic" | "editorial" | "punch" | "lowerThird" | "kidsPill" | "kidsBounce" | "kidsSticker";

export const MOTION_PACKS: { id: MotionPackId; label: string; hint: string; kidsOnly?: boolean }[] = [
  { id: "kidsSticker", kidsOnly: true, label: "Sticker", hint: "Thick outlined words that squeeze in like stickers, the spoken word yellow" },
  { id: "kidsBounce", kidsOnly: true, label: "Bounce", hint: "Rounded words bounce in as they are spoken, the spoken word bigger and warm" },
  { id: "kidsPill", kidsOnly: true, label: "Pill", hint: "The phrase in a white pill, the spoken word warm" },
  { id: "editorial", label: "Editorial", hint: "Words rise in as they are spoken, the spoken word underlined" },
  { id: "punch", label: "Punch", hint: "Bold capitals pop in, the spoken word on a coloured pill" },
  { id: "lowerThird", label: "Lower third", hint: "The phrase in a band at the bottom left, TV-documentary style" },
  { id: "classic", label: "Classic", hint: "The captions every film had before September 2026" },
];

/** What a category gets when nobody picked. Unlisted categories: classic. */
export const DEFAULT_MOTION_PACK: Record<string, MotionPackId> = {
  story: "editorial",
  kids: "kidsSticker",
};

/**
 * The packs a category offers: the three Kids styles only on a Kids story
 * (a rounded sticker caption on a documentary would be a mistake the picker
 * should not offer), the rest everywhere.
 */
export const motionPacksFor = (category: string | null | undefined) => {
  const kids = String(category ?? "").trim().toLowerCase() === "kids";
  return MOTION_PACKS.filter((p) => !p.kidsOnly || kids);
};

export const defaultMotionPackFor = (category: string | null | undefined): MotionPackId =>
  DEFAULT_MOTION_PACK[String(category ?? "").trim().toLowerCase()] ?? "classic";

/** A known pack id, or null. Refuses rather than guesses — a typo must not restyle a film. */
export function normalizeMotionPack(value: unknown): MotionPackId | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return MOTION_PACKS.some((p) => p.id === v) ? (v as MotionPackId) : null;
}
