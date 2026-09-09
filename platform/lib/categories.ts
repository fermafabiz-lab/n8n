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
        hint: "Off = the classic single narrator. Dialogue = the script becomes real dialogue between the story's characters (per-character voices are being wired in — for now one narrator reads it). Narrator per chapter = each chapter is read by a different narrator from your cast, working today.",
        type: "select",
        choices: [
          { value: "off", label: "Off — one narrator" },
          { value: "characters", label: "Dialogue" },
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
      "Fact-driven storytelling: researched narration built like a real documentary. Any scene can use real footage or photos — from the EU Audiovisual Service, DVIDS, NASA, Wikimedia Commons, a pasted URL or your own upload — instead of a generated picture, chosen scene by scene on the Images step. Every scene says on screen what it is.",
    ready: true,
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
      // `real_footage` used to sit here as a coming-soon toggle. Archive
      // footage is a per-SCENE decision made on the Images step, not a
      // project switch — a toggle here would have been a control that
      // changes nothing, which reads as a decision (the Captions rule).
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
      "A story written and drawn for young children: picture-book visuals, a warm storyteller voice, slower narration with longer breaths between scenes.",
    ready: true,
    options: [
      {
        name: "narration_pace",
        label: "Narration pace",
        hint: "Slower speech and longer breaths between scenes, so children can follow along. Relaxed is a gentle 0.9×; Very slow is 0.8× with real pauses for read-along.",
        type: "select",
        choices: [
          { value: "relaxed", label: "Relaxed" },
          { value: "very_slow", label: "Very slow — read-along" },
        ],
        default: "relaxed",
      },
      {
        name: "visual_style",
        label: "Visual style",
        hint: "Storybook is soft watercolor illustration, like a picture book. 3D animation is the rounder, more realistic look of modern animated films for kids — realistic visually, never in the story.",
        type: "select",
        choices: [
          { value: "illustrated", label: "Storybook — illustrated" },
          { value: "cartoon3d", label: "3D animation — more realistic" },
        ],
        default: "illustrated",
      },
    ],
  },
];

export const DEFAULT_CATEGORY = "story";

export function getCategory(id: string | null | undefined): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}
