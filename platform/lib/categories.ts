// Video categories — each one is a production recipe: which extra options
// the form shows, and (as they get wired into n8n) how audio and video are
// produced. Adding a category here is enough for it to appear on the site.
//
// "story" is the reference category: it is exactly today's pipeline and must
// stay that way — everything else is introduced around it, never by
// changing it.

export interface CategoryOption {
  /** Form field name — travels to n8n inside the category_options JSON. */
  name: string;
  label: string;
  /** One-line explanation shown under the control. */
  hint: string;
  type: "select" | "toggle";
  choices?: Array<{ value: string; label: string }>;
  default: string | boolean;
  /** Declared but not yet wired into the pipeline — shown, saved, inert. */
  comingSoon?: boolean;
  /** Extra UI this option switches on when enabled. */
  reveals?: "cast";
}

export interface Category {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** Fully functional today. Unready ones are selectable but say so. */
  ready: boolean;
  /** No spoken words at all: no narrator picker, no TTS, captions forced
   *  off — the film carries only its own sound effects. */
  noNarration?: boolean;
  options: CategoryOption[];
}

export const CATEGORIES: Category[] = [
  {
    id: "story",
    label: "Story",
    icon: "📖",
    description:
      "A narrated fictional story — hook, chapters, cinematic scenes. This is the classic House of Videos pipeline.",
    ready: true,
    options: [
      {
        name: "multi_voice",
        label: "Multiple voices",
        hint: "Off = the classic single narrator. Characters = the script becomes real dialogue between the story's characters (per-character voices are being wired in — for now one narrator reads it). Narrator per chapter = each chapter is read by a different narrator from your cast, working today.",
        type: "select",
        choices: [
          { value: "off", label: "Off — one narrator" },
          { value: "characters", label: "Characters speak" },
          { value: "chapters", label: "Narrator per chapter" },
        ],
        default: "off",
        // Any mode except "off" reveals the cast picker (see CategoryPicker).
        reveals: "cast",
      },
    ],
  },
  {
    id: "documentary",
    label: "Documentary",
    icon: "🎥",
    description:
      "Fact-driven storytelling: researched narration built like a real documentary, with room for real footage between generated scenes.",
    ready: false,
    options: [
      {
        name: "multi_voice",
        label: "Multiple narrators",
        hint: "Each chapter is read by a different narrator from your cast — the classic multi-host documentary feel. (Character voices don't apply here.)",
        type: "select",
        choices: [
          { value: "off", label: "Off — one narrator" },
          { value: "chapters", label: "Narrator per chapter" },
        ],
        default: "off",
        reveals: "cast",
      },
      {
        name: "real_footage",
        label: "Real images between scenes",
        hint: "Interleave real photos/archive stills (uploaded by you) as B-roll over the narration.",
        type: "toggle",
        default: false,
        comingSoon: true,
      },
      {
        name: "source_rigor",
        label: "Research depth",
        hint: "How aggressively the script hunts for dates, names and verifiable facts.",
        type: "select",
        choices: [
          { value: "standard", label: "Standard" },
          { value: "deep", label: "Deep — slower, more specific" },
        ],
        default: "standard",
        comingSoon: true,
      },
    ],
  },
  {
    id: "cinematic",
    label: "Cinematic",
    icon: "🎬",
    description:
      "No narration at all — a pure visual film carried by its own sound: engines, tires, rain, impacts. For car scenes, action sequences, atmosphere pieces.",
    ready: true,
    noNarration: true,
    options: [],
  },
  {
    id: "kids",
    label: "Kids story",
    icon: "🧸",
    description:
      "Gentle pacing for young listeners: slower narration, longer pauses between scenes, softer scene transitions.",
    ready: false,
    options: [
      {
        name: "narration_pace",
        label: "Narration pace",
        hint: "Slower speech and longer breaths between scenes, so children can follow along.",
        type: "select",
        choices: [
          { value: "relaxed", label: "Relaxed" },
          { value: "very_slow", label: "Very slow — read-along" },
        ],
        default: "relaxed",
        comingSoon: true,
      },
    ],
  },
];

export const DEFAULT_CATEGORY = "story";

export function getCategory(id: string | null | undefined): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}
