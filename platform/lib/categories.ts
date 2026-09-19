// Video categories — each one is a production recipe: which extra options
// the form shows, and (as they get wired into n8n) how audio and video are
// produced. Adding a category here is enough for it to appear on the site.
//
// "story" is the reference category: it is exactly today's pipeline and must
// stay that way — everything else is introduced around it, never by
// changing it.

import type { Tone } from "./tones";

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
  /**
   * The narrator this category picks by itself, as the prefixed id the
   * picker stores — selected on screen the moment the category is chosen,
   * so the producer sees who will read and can change it like any other
   * voice. Only an untouched picker follows it. Absent = the picker's own
   * default. A film in another language still gets the language's own
   * list: a voice that does not speak it is replaced by the first that
   * does, exactly as the picker already does for a typed choice.
   */
  narratorVoice?: string;
  /**
   * The tone this kind of film is written in before the producer touches the
   * row — the `hov.genre_profile` Claude Scripting loads, which decides the
   * structure, the voice and the words per minute.
   *
   * Not a suggestion and not a hidden default: the brief lights the chip the
   * moment the category is chosen, so the producer SEES it and is one click
   * from changing it — the same contract `narratorVoice` has. Only an
   * untouched row follows the category; a tone the producer picked is theirs
   * from then on, whatever the category does afterwards.
   *
   * REQUIRED on purpose, so a category added here cannot forget it and
   * quietly inherit somebody else's mood — and typed as `Tone`, so a
   * misspelling is a build error rather than a film written with Scripting's
   * DOCUMENTARY fallback. See `lib/tones.ts` for why that failure is silent.
   */
  defaultTone: Tone;
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
    defaultTone: "Epic",
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
    defaultTone: "Documentary",
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
    defaultTone: "Cinematic",
    options: [],
  },
  {
    id: "kids",
    label: "Kids story",
    icon: "🧸",
    description:
      "A story written and drawn for young children: picture-book visuals, a warm storyteller voice, slower narration with longer breaths between scenes.",
    ready: true,
    // George — ElevenLabs' own "Warm, Captivating Storyteller", the one voice
    // in the library labelled narrative_story in English. Read with the
    // Storyteller tone (STORYTELLER_TONE in derive.ts), which the brief
    // selects alongside it.
    narratorVoice: "elevenlabs_JBFqnCBsd6RMkjVDRZzb",
    // The bedtime-story writing profile — db/port/childish-tone/, row
    // recpa1ZmZmXFnGjDi, 110 wpm. This is where Kids story's tone default
    // was born; the other three categories got theirs on 2026-09-19.
    defaultTone: "Childish",
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
        hint: "The look of every frame — every scene, character sheet and set plate opens with it. Storybook is soft watercolour like a picture book; 3D animation is the rounder look of modern animated films — realistic visually, never in the story. Brick, clay and felt are animated as stop motion: small deliberate steps rather than smooth glides.",
        type: "select",
        // One flat list, not medium × technique: "2D claymation" and "3D
        // watercolour" are not things. The values are the keys of
        // KIDS_STYLES in Claude Scripting's Voice Mode (and its two copies
        // in Media Generation) — db/port/sheet-style/check.mjs asserts this
        // list matches them, so add a style there first. No brand is ever
        // named: "brick-built" is the toy, not the company.
        choices: [
          { value: "illustrated", label: "Storybook — soft watercolour" },
          { value: "crayon", label: "Crayon and chalk — drawn by a child" },
          { value: "papercut", label: "Paper cut-out — layered collage" },
          { value: "cel", label: "Classic 2D — hand-painted cel animation" },
          { value: "cartoon3d", label: "3D animation — more realistic" },
          { value: "brick", label: "Brick-built — plastic toy bricks" },
          { value: "clay", label: "Clay stop-motion — plasticine" },
          { value: "felt", label: "Felt and wool — soft toys" },
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
