"use client";

import { useActionState, useEffect, useState } from "react";
import { createProject, type ActionResult } from "@/app/actions";
import CategoryPicker, { type CategoryMeta } from "@/components/CategoryPicker";
import { DEFAULT_CATEGORY, getCategory } from "@/lib/categories";
import { TONES } from "@/lib/tones";
import Toggle from "@/components/Toggle";
import CaptionColorPicker from "@/components/CaptionColorPicker";
import { MOTION_PACKS, defaultMotionPackFor, motionPacksFor, type MotionPackId } from "@/lib/motion-packs";
import { GRAPHIC_STYLES, graphicStylesFor, offersGraphicStyle, type GraphicStyleId } from "@/lib/graphic-styles";
import { TRANSITION_STYLES, type TransitionStyleId } from "@/lib/transition-styles";
import WatermarkOpenPicker from "@/components/WatermarkOpenPicker";
import WatermarkSizePicker from "@/components/WatermarkSizePicker";
import WatermarkPreview, { SAMPLE_SCENES } from "@/components/WatermarkPreview";
import LanguagePicker from "@/components/LanguagePicker";
import Link from "next/link";
import { languageByCode, resolveLanguage } from "@/lib/languages";
import type { SeriesPrefill } from "@/lib/series";
import sc from "@/components/SeriesCast.module.css";
import { toneType } from "@/lib/tone-type";
import SpeedPicker from "@/components/SpeedPicker";
import VoiceTonePicker from "@/components/VoiceTonePicker";
import StyleRefPicker from "@/components/StyleRefPicker";
import type { HookStyleChoice, VoiceTone } from "@/lib/data/derive";
import { CREATORS, FLOW_ACCOUNTS_MAX, HOOK_STYLES, SPEED_BY_PACE, STORYTELLER_TONE } from "@/lib/data/derive";
import { AUTO_STEPS, AUTO_STEP_LABELS, describeAutoSteps, withAutoStep, type AutoStep } from "@/lib/hands-off";

async function submit(_prev: ActionResult | null, formData: FormData) {
  return createProject(formData);
}

// The tone chips are `TONES` from lib/tones.ts — same option set as the n8n
// form, which the site fully replaces. There is no DEFAULT_TONE any more:
// the tone a producer lands on is the CATEGORY's (`defaultTone`), so "what
// kind of film" and "how it should feel" stop being two unrelated questions.

/** Dashed suggestion chips under the subject — one click fills the field. */
const SUGGESTIONS = [
  "The last lighthouse keepers",
  "How Rome fed a million people",
  "Cities that never woke up",
];

/**
 * The "Look" chips. Each one FILLS the free-text style field rather than
 * replacing it: the chips are the eight looks the prototype draws, but a
 * producer who wants "35mm, golden hour, handheld" must still be able to
 * write it, and the posted `style` value stays a plain string either way.
 */
const LOOKS = [
  "Documentary",
  "Nature",
  "History",
  "Coast",
  "Mountains",
  "Space",
  "Cyberpunk",
  "Horror",
];

/**
 * How much the subject field takes.
 *
 * It was 140, which is a tweet — and wrong twice over: `project.name` is
 * `text` in Postgres with no server-side cap, and `ExpandableTitle` exists
 * precisely because "people paste whole prompts into the Tema field". The UI
 * was the only thing refusing what the rest of the stack already handled.
 *
 * Still bounded, because this field is also the project's NAME and shows up
 * in every list. 1000 is a real brief with room to spare; past that it is a
 * script, and the Lore field is where a script belongs.
 */
const SUBJECT_MAX = 1000;

/**
 * Length presets, in seconds — round numbers, not scene multiples.
 *
 * They used to be 32 and 64 because a scene is an 8-second clip, and the
 * slider snapped to 8 for the same reason. But the number is only a TARGET:
 * scripting turns it into a word budget and a chapter count, and the finished
 * film's real length comes from the narration retime in /assemble — so
 * nothing downstream needs a multiple of anything, and a chip reading
 * "1 min" that actually set 1:04 was a machine's number wearing a human
 * label. The slider now moves in 5s steps; the field next to the readout
 * takes any exact second.
 */
const LENGTH_PRESETS = [
  { label: "30s", s: 30 },
  { label: "1 min", s: 60 },
  { label: "2 min", s: 120 },
  { label: "4 min", s: 240 },
  { label: "8 min", s: 480 },
  { label: "10 min", s: 600 },
  { label: "12 min", s: 720 },
];

/**
 * The SFX volume slider's ends, as percentages.
 *
 * The floor is 10 rather than 0 because silence is what the SFX toggle is
 * for — a slider that could reach 0 would be a second off switch, one that
 * disagrees with the one right next to it. The default matches the level the
 * render hard-coded before this control existed (0.35), so an untouched
 * slider is exactly today's sound.
 */
const SFX_LEVEL_PCT_MIN = 10;
const SFX_LEVEL_PCT_DEFAULT = 35;
/** Same shape for the background track: 22 is the gain the mixer has always
 *  used for the music bed, so an untouched slider is today's sound. Steps of
 *  1 rather than 5 so the default sits on the scale. */
const MUSIC_LEVEL_PCT_MIN = 5;
const MUSIC_LEVEL_PCT_DEFAULT = 22;

/**
 * The Veo tiers, priced per 8s clip in useapi credits (measured on the
 * account — 25,050/month). Ids must stay in lockstep with VIDEO_MODELS in
 * lib/data/derive.ts and with what `Current Scene` in n8n accepts: the
 * string reaches the Flow API verbatim.
 */
const VIDEO_TIERS = [
  { id: "veo-3.1-lite-low-priority", label: "Free", credits: 0, note: "" },
  {
    id: "veo-3.1-lite",
    label: "Better",
    credits: 5,
    note: "Same model, real queue priority — clips arrive much faster and slightly cleaner.",
  },
  {
    id: "veo-3.1-fast",
    label: "Fast",
    credits: 10,
    note: "A stronger model — noticeably fewer physics glitches, good default for films worth posting.",
  },
  {
    id: "veo-3.1-quality",
    label: "Cinema",
    credits: 100,
    note: "The best Veo on offer — for films where every shot has to hold up.",
  },
] as const;

/**
 * The length slider's ends, and the number field's.
 *
 * One owner, because the range input, the number input and the fill
 * percentage all have to agree — they were three copies of `480`, and a
 * preset above a stale max is a chip that moves the slider nowhere.
 */
// 15, not 16: a range input counts its steps FROM `min`, so with a 5s step a
// floor of 16 would put every reachable value on 16, 21, 26… 716 — never a
// round number, never a preset, and never the max. On the 15…720 grid every
// drag position ends in 0 or 5 and the last one IS 720.
const LENGTH_MIN = 15;
const LENGTH_MAX = LENGTH_PRESETS[LENGTH_PRESETS.length - 1].s;

/**
 * The overlay finishes, as numbered switch rows. Field names and yes/no
 * values are the exact strings createProject() forwards to n8n — the
 * redesign must never change that contract.
 */
const FINISHES: Array<{
  name:
    | "captions"
    | "chapter_cards"
    | "end_screen"
    | "sfx"
    | "drawn_cards"
    | "music"
    | "source_watermark";
  label: string;
  sheet: string;
  on: string;
  off: string;
  default: boolean;
}> = [
  {
    name: "captions",
    label: "Captions",
    sheet: "Captions",
    on: "Subtitles on screen, paced to the narration",
    off: "No subtitles — visuals and voice only",
    default: true,
  },
  // "Opening title" left this list on 2026-09-11: the title card is retired
  // and every film opens on a teaser of fast shots. Its STYLE is the "Cold
  // open" control in the same section, posted as `hook_style`.
  {
    name: "chapter_cards",
    label: "Chapter cards",
    sheet: "Cards",
    on: "A full-screen card announces each chapter",
    off: "Straight cuts between chapters",
    default: true,
  },
  {
    name: "end_screen",
    label: "End screen",
    sheet: "End screen",
    on: "Channel outro plays after the last scene",
    off: "The video ends on the last scene",
    default: true,
  },
  {
    name: "sfx",
    label: "Sound effects",
    sheet: "SFX",
    on: "Each scene's own ambience plays quietly under the narration",
    off: "The clips stay silent — narration only",
    default: true,
  },
  {
    name: "drawn_cards",
    label: "Drawn cards",
    sheet: "Cards",
    on: "Where the voice names something the camera cannot show, the film draws it",
    off: "No drawn cards — footage and text only",
    default: true,
  },
  {
    name: "music",
    label: "Music",
    sheet: "Music",
    on: "Background track plus whoosh/boom accents at the cuts",
    off: "No added music or accents",
    default: false,
  },
  {
    name: "source_watermark",
    label: "Source watermark",
    sheet: "Source",
    // The spec's own sentence, because it is the one that explains WHY the
    // switch exists rather than what it toggles.
    on: "Show a small label indicating whether each visual is AI-generated, authentic, archival, or illustrative.",
    off: "No origin label on screen — the provenance is still recorded, and a credit a licence requires is still shown",
    default: true,
  },
];

const VOICE_LABELS: Record<string, string> = {
  silent: "None — silent film",
  off: "Single narrator",
  // Same name the mode is offered under in the form — the preview must not
  // invent a second one for it.
  characters: "Dialogue",
  chapters: "Narrator per chapter",
};

/**
 * The brief, in the handoff's Start-screen layout: the form as a stack of
 * numbered cushioned cards, and a sticky rail on the right holding the dark
 * ESTIMATE panel — which absorbed the old call-sheet preview (including the
 * tone-typeface title, lib/tone-type.ts mirroring the render) and now also
 * carries the submit — plus the genre pole and the what-happens-next card.
 *
 * Every posted field name and value vocabulary is byte-identical to before:
 * name, category, cat_*, cast_voices, language, length, tone, pace, style,
 * voice_id, aspect, the yes|no finishes, lore, reference_image. The frozen
 * contract with the n8n webhook survives any redesign.
 *
 * `speed` is the one ADDITION (2026-08-17), and `pace` is unchanged beside it:
 * the word still goes to the two writing prompts that read it, while the
 * number is what actually re-times the film. The word is derived from the
 * number so they can never disagree.
 */
/**
 * `series` is the show this brief is the next episode of, or null for a
 * plain film. It pre-fills what a show keeps fixed — category and its
 * options, tone, language, aspect, narrator, voice character, pace, cold
 * open, video tier — and posts the hidden `series_id`; the title, the idea
 * and the length are this episode's own. Every posted field name stays as it
 * was: the webhook contract does not know what a series is.
 */
export default function NewVideoForm({ series }: { series: SeriesPrefill | null }) {
  const [state, formAction, pending] = useActionState(submit, null);
  // Who on the team is starting this film. Not an account — the site has one
  // shared password — just the name that goes on the project so the four of
  // them can see who made what.
  const [createdBy, setCreatedBy] = useState("");
  const [name, setName] = useState("");
  // The category is chosen before the tone is (section 01 is above section
  // 02), and it decides the tone — so the initial value has to be read from
  // the SAME category the picker starts on, not from a constant. Computed
  // once here because `category`'s own state is declared further down, and
  // two `?? DEFAULT_CATEGORY` that could drift apart is how a form ends up
  // starting on a tone no category asked for.
  const initialCategory = series?.category ?? DEFAULT_CATEGORY;
  const [tone, setTone] = useState(series?.tone || getCategory(initialCategory).defaultTone);
  // Has the producer clicked a tone chip themselves? The effect below moves
  // the tone with the category only while this is false.
  //
  // It has to be a flag rather than "is the tone still the default?", which
  // is what the kids-only version of this used to test: now that every
  // category has a default, that test cannot tell a producer who deliberately
  // clicked "Epic" on a Story film from one who never touched the row — and
  // would overwrite the first one's choice the moment they changed category.
  // A series episode starts TOUCHED: the show's tone is a decision already
  // made, recorded on the show, and nothing here may stomp it.
  const [toneTouched, setToneTouched] = useState(Boolean(series?.tone));
  const [length, setLength] = useState(series?.lengthSeconds ?? 60);
  const [aspect, setAspect] = useState<"16:9" | "9:16">(series?.aspect ?? "16:9");
  // The rate is the state; the WORD the webhook wants is derived from it.
  // SPEED_BY_PACE maps the words to the gentle defaults, so Normal posts 1
  // and a project that only ever carried "Slow" still resolves the same way.
  const [speed, setSpeed] = useState(series?.speed ?? SPEED_BY_PACE.normal);
  const pace = speed < 1 ? "Slow" : speed > 1 ? "Fast" : "Normal";

  // The same person usually starts several films in a row from the same
  // machine, so the last choice comes back pre-selected — otherwise this is
  // one more click on every brief and the honest outcome is that nobody
  // bothers and the score is empty. Read AFTER mount, never in the state
  // initializer: localStorage does not exist on the server, and seeding from
  // it there would make the first paint disagree with the hydration.
  //
  // It is remembered, not assumed: the chips sit at the top of the form with
  // the current name lit, so somebody else at the same desk sees a name that
  // is not theirs before they type a word.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("hov-created-by");
      if (saved && (CREATORS as readonly string[]).includes(saved)) setCreatedBy(saved);
    } catch {
      // A private window or blocked site data: the picker simply starts empty.
    }
  }, []);

  const pickCreator = (who: string) => {
    setCreatedBy(who);
    try {
      localStorage.setItem("hov-created-by", who);
    } catch {
      // Not remembering is survivable; not recording it on the project is not,
      // and that goes through the form, not through here.
    }
  };
  // The language as an ISO code — the picker's own currency. What n8n gets
  // is the English name, below.
  const [language, setLanguage] = useState(
    (series?.language && resolveLanguage(series.language)?.code) || "en",
  );
  // The overlays: each switch is the series' answer where the show has one,
  // and the form's own default everywhere else. A series created before the
  // settings were carried stores none of them and opens exactly as a fresh
  // brief does.
  const [finishes, setFinishes] = useState<Record<string, boolean>>(
    Object.fromEntries(
      FINISHES.map((f) => [f.name, series?.finishes?.[f.name] ?? f.default]),
    ),
  );
  // How the film opens. `auto` — the default — lets Scripting choose among
  // the six styles; a named one forces it. Posted as `hook_style`, stored by
  // Normalize Webhook Input as Editing Options.hookStyle, read by Voice Mode.
  const [hookStyle, setHookStyle] = useState<HookStyleChoice>(
    series?.hookStyle && HOOK_STYLES.some((h) => h.id === series.hookStyle)
      ? (series.hookStyle as HookStyleChoice)
      : "auto",
  );
  // How loud the scenes' own ambience sits under the narration, as a
  // percentage for the producer and 0–1 for the mixer. 35 is the level the
  // render used to hard-code, so leaving the slider alone reproduces every
  // film made before this control existed.
  const [sfxLevel, setSfxLevel] = useState(
    series?.sfxLevel != null ? Math.round(series.sfxLevel * 100) : SFX_LEVEL_PCT_DEFAULT,
  );
  // How loud the background track sits under the voice, same unit and same
  // rule as the effects — shown only while Music is on.
  const [musicLevel, setMusicLevel] = useState(
    series?.musicLevel != null ? Math.round(series.musicLevel * 100) : MUSIC_LEVEL_PCT_DEFAULT,
  );
  // Hex, or "" for the white default. Empty is not "unset" — it is the
  // choice most films should keep, so it is what the control starts on.
  const [captionColor, setCaptionColor] = useState(series?.captionColor ?? "");
  // How often the source badge opens into its full label. FALSE — every run
  // of shots announces itself — is the default and has to stay so: a film
  // that quietly stops naming its sources is the failure the whole overlay
  // exists to prevent, so absence resolves to the louder choice everywhere.
  const [watermarkOpenOnce, setWatermarkOpenOnce] = useState(false);
  // How big the badge is drawn. 1 is the size every film before this was
  // rendered at, and the slider's own default — see WATERMARK_SCALE.
  const [watermarkScale, setWatermarkScale] = useState(1);
  // How the graphics move (lib/motion-packs.ts). "" is "Auto": nothing is
  // stored and the render uses the category's default, so the pick follows
  // the category until the producer makes one.
  const [motionPack, setMotionPack] = useState<MotionPackId | "">("");
  // Which graphics ride over the footage (lib/graphic-styles.ts). "" is "AI
  // picks": the pipeline chooses by the film's theme once the scenes exist.
  const [graphicStyle, setGraphicStyle] = useState<GraphicStyleId | "">("");
  // How the picture hands over at a few cuts (lib/transition-styles.ts), for
  // every category. "" is "AI picks", by the film's theme.
  const [transitionStyle, setTransitionStyle] = useState<TransitionStyleId | "">("");
  const [style, setStyle] = useState(series?.style ?? "");
  // Hands-off mode: WHICH gates sign themselves off (lib/hands-off.ts). Off by
  // default — approving unseen is a real trade, and it must never be the
  // accident. Switching it on picks every step, which is what the one switch
  // always meant; then any step can be taken back out. An episode starts from
  // what its show chose, and a show frozen before the choice existed from its
  // old all-or-nothing switch.
  const [autoSteps, setAutoSteps] = useState<AutoStep[]>(
    () => series?.autoApproveSteps ?? (series?.autoApprove ? [...AUTO_STEPS] : []),
  );
  // The producer's direction: the film's angle in their own words, and up to
  // three mandatory beats (one per line). Both optional, both steer the
  // writer; the must-includes are verified by the Narration Guard.
  const [brief, setBrief] = useState("");
  const [mustHaves, setMustHaves] = useState("");
  const [expanding, setExpanding] = useState(false);
  const [expandNote, setExpandNote] = useState("");
  // "✨ Suggest the next episode" — the series-only twin of Develop my idea.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState("");
  // Which Veo tier generates the clips. Free is the default and the business
  // model; a paid tier is a per-film decision, priced on the spot.
  const [videoModel, setVideoModel] = useState(series?.videoModel || "veo-3.1-lite-low-priority");
  // Parallel clip generation. OFF by default on purpose: it has been measured
  // on one disposable film, not on a real one, and it changes the failure
  // shape as well as the speed — with three accounts running at once the
  // SLOWEST account is the film, where the serial loop spreads a bad clip's
  // cost out. Flip the default once a real film has gone through it.
  const [parallelClips, setParallelClips] = useState(false);
  // The category selection lives here because BOTH halves of CategoryPicker
  // read it and they are rendered in different cards.
  const [category, setCategory] = useState(initialCategory);
  const [catValues, setCatValues] = useState<Record<string, string | boolean>>(
    series
      ? Object.fromEntries(
          Object.entries(series.categoryOptions).map(([k, v]) => [`${series.category}:${k}`, v]),
        )
      : {},
  );
  /** How the narrator reads. `null` — the default — sends nothing and leaves
   *  whatever voice is picked reading as it already does. */
  const [voiceTone, setVoiceTone] = useState<VoiceTone | null>(series?.voice ?? null);
  // Kids story reads like a storyteller by default — and says so. Choosing
  // the category selects the Storyteller preset in the control below, where
  // the producer can see it and change it; leaving the category puts the
  // control back to "Voice default". Only an untouched control moves either
  // way: a tone the producer chose is theirs, whatever the category does.
  // `createProject` keeps the same default as a backstop for a form that
  // never rendered the control, from the same constant.
  useEffect(() => {
    // An episode arrives with the show's voice tone already chosen, and a
    // show that deliberately reads in the plain voice stores null — which
    // is indistinguishable, below, from a producer who has not touched the
    // control. So on an episode still in its own category this effect has
    // nothing to help with and must not guess; it wakes up only if the
    // producer moves this episode to a different one. (The WRITING tone is
    // already safe either way: `toneTouched` starts true on a show that has
    // one.)
    if (series && category === series.category) return;
    const isStoryteller = (t: VoiceTone | null) =>
      !!t && t.stability === STORYTELLER_TONE.stability && t.similarity === STORYTELLER_TONE.similarity &&
      t.style === STORYTELLER_TONE.style && t.speakerBoost === STORYTELLER_TONE.speakerBoost;
    if (category === "kids" && voiceTone === null) setVoiceTone(STORYTELLER_TONE);
    else if (category !== "kids" && isStoryteller(voiceTone)) setVoiceTone(null);
    // The WRITING tone moves with the category the same way, and for every
    // category rather than only Kids story: a Story film is Epic, a
    // Documentary is Documentary, a Cinematic one is Cinematic, a Kids story
    // is Childish. The chip lights up so the producer sees which profile will
    // write the script, and one click overrides it for good — `toneTouched`
    // is never cleared, so the category can no longer take the row back.
    if (!toneTouched) setTone(getCategory(category).defaultTone);
    // Runs on the category, not on the tone: a producer switching the tone
    // away and back must not be fought by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);
  const [catMeta, setCatMeta] = useState<CategoryMeta>({
    category: DEFAULT_CATEGORY,
    categoryLabel: getCategory(DEFAULT_CATEGORY).label,
    voiceMode: "off",
    ready: getCategory(DEFAULT_CATEGORY).ready,
  });

  const lang = languageByCode(language);
  const languageName = lang?.name ?? "English";

  /** "✨ Develop my idea" — n8n's expand-brief webhook (the model keys live
   *  there) turns the subject + rough draft into 2-4 sharper sentences, in
   *  the film's language. Fills the textarea, stays fully editable; any
   *  failure leaves whatever was typed untouched. */
  const expandIdea = async () => {
    setExpanding(true);
    setExpandNote("");
    try {
      const res = await fetch("/api/expand-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tema: name, brief, tone, language: languageName }),
      });
      const out = (await res.json()) as { brief?: string | null };
      if (out.brief) {
        setBrief(out.brief);
        setExpandNote("Developed — edit it freely, it's your text now.");
      } else {
        setExpandNote("Couldn't develop it right now — your text is untouched.");
      }
    } catch {
      setExpandNote("Couldn't develop it right now — your text is untouched.");
    } finally {
      setExpanding(false);
    }
  };

  /** "✨ Suggest the next episode" — the button the empty title field needs
   *  on a show. n8n's `series-next` webhook is given the premise, the cast,
   *  the places, the recap and every title already used, and answers with a
   *  title and a one-paragraph idea for episode N. Both land in the fields
   *  and stay editable; a refusal leaves whatever was typed alone, exactly
   *  like Develop my idea. The idea is only filled when the box is EMPTY —
   *  a producer who has already written their own direction must not lose
   *  it to a suggestion they asked for about the title. */
  const suggestEpisode = async () => {
    if (!series) return;
    setSuggesting(true);
    setSuggestNote("");
    try {
      const res = await fetch("/api/series-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series_id: series.id, language: languageName }),
      });
      const out = (await res.json()) as { title?: string | null; idea?: string | null };
      if (out.title) {
        setName(out.title);
        const keptBrief = brief.trim().length > 0;
        if (out.idea && !keptBrief) setBrief(out.idea);
        setSuggestNote(
          keptBrief && out.idea
            ? "Here is an episode — your own direction below was left as it is."
            : "Here is an episode — edit both freely, they're yours now.",
        );
      } else {
        setSuggestNote("Couldn't think of one right now — nothing was changed.");
      }
    } catch {
      setSuggestNote("Couldn't think of one right now — nothing was changed.");
    } finally {
      setSuggesting(false);
    }
  };
  const scenes = Math.max(1, Math.round(length / 8));
  const words = scenes * 22;
  const chapters = Math.max(1, Math.ceil(length / 120));
  const tt = toneType(tone);
  const silent = catMeta.voiceMode === "silent";
  // A category with no cold open (Cinematic) shows no Cold open row and does
  // not price the teaser's shots — Scripting writes none for it.
  const noHook = getCategory(category).noHook === true;
  // The steps this category can have. A silent film has no takes, so no Audio
  // chip — and a list holding only Audio has to read as OFF, or the switch
  // would stay on with nothing on screen chosen.
  const autoChoices = AUTO_STEPS.filter((st) => !(silent && st === "audio"));
  const autoShown = autoSteps.filter((st) => autoChoices.includes(st));
  const autoApprove = autoShown.length > 0;
  const autoAll = autoChoices.every((st) => autoSteps.includes(st));
  const gates = silent ? 3 : 4;
  const finishList = FINISHES.filter(
    (f) =>
      finishes[f.name] &&
      !(silent && f.name === "captions") &&
      // Same gate as the row itself: the estimate must not promise "Source"
      // on a film that will not draw it.
      !(f.name === "source_watermark" && category !== "documentary"),
  )
    .map((f) => f.sheet)
    .join(" · ");
  const lengthLabel = `${Math.floor(length / 60)}:${String(length % 60).padStart(2, "0")}`;
  const sliderPos = Math.min(Math.max(length, LENGTH_MIN), LENGTH_MAX);
  const sliderFill = `${((sliderPos - LENGTH_MIN) / (LENGTH_MAX - LENGTH_MIN)) * 100}%`;

  return (
    <main className="page nb">
      <div className="nb-shell">
        <div className="arc" aria-hidden="true" />

        <form
          action={formAction}
          onKeyDown={(e) => {
            // Enter in a text field implicitly submits an HTML form, and here
            // submitting means starting a real production run: a project is
            // written to the database, scripting starts, model credits are
            // spent. Pressing Enter after typing the title, or to accept a
            // voice search, did exactly that. Starting a film should take a
            // click.
            //
            // Only INPUT is blocked, deliberately. A textarea's Enter is a
            // newline and never submits, and a button's Enter is that
            // button's own activation — so "Start production" still works
            // from the keyboard, and so do every chip and toggle (all
            // type="button"). isComposing guards IME entry, where Enter
            // commits a candidate rather than reaching the form at all.
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              (e.target as HTMLElement).tagName === "INPUT"
            ) {
              e.preventDefault();
            }
          }}
        >
          <div className="brief">
            <div className="form">
              {series && <input type="hidden" name="series_id" value={series.id} />}
              {/* The header rides in the form column so the estimate rail
                  starts on the same line as the title rather than a header's
                  height below it.

                  On an episode it IS the show: the producer arrived here
                  from a series and the page has to say so before it asks
                  anything — the show's name where the page title goes, the
                  episode number in the pill, and underneath the two facts
                  that make it an episode rather than a film with a borrowed
                  look: who is in it, and what happened last time. The old
                  version kept "Start a video" at the top with a thin strip
                  above it, and the producer read the whole page as a new
                  film. */}
              <div className="nb-head">
                <span className="nb-pill">
                  <i />
                  {series ? `Episode ${series.episodeNo}` : "New project"}
                </span>
                <h1>{series ? series.name : "Start a video"}</h1>
                {series ? (
                  <p>
                    The next episode of your show. Everything below is already
                    answered the way the series is made — the cast, the places,
                    the look, the length, the voice and the overlays — so change
                    only what this episode needs.{" "}
                    <Link href={`/series/${series.id}`} className="nb-serieslink">
                      Open the series ↗
                    </Link>
                  </p>
                ) : (
                  <p>
                    Fill in the brief and the pipeline takes it from there.
                    Everything after this happens without you — until the script
                    and the scenes come back for approval.
                  </p>
                )}
                {series && (series.characters.length > 0 || series.previously) && (
                  <div className={sc.banner} style={{ marginTop: 14 }}>
                    <div>
                      {series.characters.length > 0 && (
                        <b>
                          {series.characters.slice(0, 6).join(" · ")}
                          {series.characters.length > 6 ? " · …" : ""}
                        </b>
                      )}
                      {series.places.length > 0 && (
                        <p>
                          {series.places.slice(0, 4).join(" · ")}
                          {series.places.length > 4 ? " · …" : ""}
                        </p>
                      )}
                      {/* The last line of the recap, not the whole thing: it
                          is here to remind, and the pipeline reads all of it
                          anyway. */}
                      {series.previously && (
                        <p style={{ marginTop: 6 }}>
                          <i>Last time:</i>{" "}
                          {series.previously.split("\n").filter(Boolean).slice(-1)[0]}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Before anything about the film: who is making it. It sits
                    above the brief rather than inside a numbered section
                    because it is not a property of the video — it is the
                    person at the keyboard, and it is asked once, first.

                    The posted name is the whole feature: it rides the webhook
                    into Editing Options and comes back on every card, so the
                    four of them can see who made what. Nothing downstream
                    reads it — no prompt, no render, no gate. */}
                <input type="hidden" name="created_by" value={createdBy} />
                <div className="field" style={{ marginTop: 22 }}>
                  <label htmlFor="created_by_group">Who is making this</label>
                  <div className="chiprow" id="created_by_group" role="group" aria-label="Who is making this">
                    {CREATORS.map((who) => (
                      <button
                        type="button"
                        key={who}
                        className={`pchip ${createdBy === who ? "on" : ""}`}
                        aria-pressed={createdBy === who}
                        onClick={() => pickCreator(who)}
                      >
                        {who}
                      </button>
                    ))}
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--dim)" }}>
                    {createdBy
                      ? `This film goes on ${createdBy}'s name. Remembered on this computer — change it if it is not you.`
                      : "Pick your name before starting — it is what the count on the projects page is made of."}
                  </p>
                </div>
              </div>

              <section className="fsec">
                <header>
                  <h2>What is it about</h2>
                  <span className="no">01</span>
                </header>
                <div className="field">
                  <textarea
                    id="name"
                    name="name"
                    className="nb-ta"
                    rows={3}
                    placeholder="A documentary about the last lighthouse keepers — who they were, and what happened when the lamps went automatic."
                    maxLength={SUBJECT_MAX}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--dim)" }}>
                    A short line becomes the film&apos;s opening title card; a
                    longer brief is used as the subject and the film opens
                    straight on the first scene. Style details go in the Look
                    field, not here.
                    {/* Silence is what made the old 140 a wall: the field
                        simply stopped accepting letters. The count appears
                        before the limit does, never after. */}
                    {name.length > SUBJECT_MAX - 150 && (
                      <>
                        {" "}
                        <b style={{ color: name.length >= SUBJECT_MAX ? "var(--accent)" : "var(--ink)" }}>
                          {name.length}/{SUBJECT_MAX}
                        </b>
                      </>
                    )}
                  </p>
                  {/* The stock suggestions are whole film ideas — a
                      lighthouse documentary is not episode 4 of anybody's
                      show, so on an episode they are replaced by the one
                      button that IS useful here: ask the show what should
                      happen next. */}
                  {series ? (
                    <div className="sugrow" aria-label="Episode suggestion">
                      <button
                        type="button"
                        className="sug"
                        onClick={suggestEpisode}
                        disabled={suggesting}
                        aria-busy={suggesting}
                      >
                        {suggesting ? "Thinking…" : `✨ Suggest episode ${series.episodeNo}`}
                      </button>
                      {suggestNote && (
                        <span style={{ fontSize: 12, color: "var(--dim)", alignSelf: "center" }}>
                          {suggestNote}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="sugrow" aria-label="Suggestions">
                      {SUGGESTIONS.map((sg) => (
                        <button type="button" key={sg} className="sug" onClick={() => setName(sg)}>
                          {sg}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* The producer's direction — the cheapest quality lever there
                    is. A five-word title under-specifies a whole film; these
                    two optional fields carry the angle and the mandatory
                    beats. Both are STORED on the project (unlike Lore, which
                    a restart loses), read by the Story Bible, the outline and
                    the narration prompts — and the must-includes are VERIFIED
                    by the Narration Guard after writing, because an
                    instruction in a prompt is not a constraint. */}
                <div className="field" style={{ marginTop: 22 }}>
                  <label>
                    What the film should really be about{" "}
                    <span className="fhint">optional — the angle, in your own words</span>
                  </label>
                  <textarea
                    name="brief"
                    className="nb-ta"
                    rows={3}
                    maxLength={2000}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="The point of view, what to focus on, what to leave out — e.g. 'Not the whole biography: only the night of the crime and the investigation, told through the witnesses.'"
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={expanding || !name.trim()}
                      title={name.trim() ? "Let AI develop your idea into a sharper brief — editable after" : "Write the subject above first"}
                      onClick={expandIdea}
                    >
                      {expanding ? "Developing…" : "✨ Develop my idea"}
                    </button>
                    {expandNote && (
                      <span style={{ fontSize: 12, color: "var(--dim)" }}>{expandNote}</span>
                    )}
                  </div>
                </div>
                <div className="field" style={{ marginTop: 22 }}>
                  <label>
                    Must appear in the film{" "}
                    <span className="fhint">optional — up to 3, one per line; the writer is checked on each</span>
                  </label>
                  <textarea
                    name="must_haves"
                    className="nb-ta"
                    rows={3}
                    maxLength={650}
                    value={mustHaves}
                    onChange={(e) => setMustHaves(e.target.value)}
                    placeholder={"The moment the deal collapses\nWhy the case stayed unsolved for 27 years"}
                  />
                </div>
                <div className="field" style={{ marginTop: 22 }}>
                  <label>What kind of film</label>
                  <CategoryPicker
                    part="category"
                    onMeta={setCatMeta}
                    language={language}
                    selected={category}
                    onSelected={setCategory}
                    values={catValues}
                    onValues={setCatValues}
                  />
                </div>
              </section>

              <section className="fsec">
                <header>
                  <h2>How it should feel</h2>
                  <span className="no">02</span>
                </header>
                <div className="field">
                  <label>
                    Tone{" "}
                    {/* Which of the two states the row is in, said out loud.
                        Without this the producer cannot tell a tone the
                        category chose from one they chose — and so cannot
                        tell that changing the category will, or will not,
                        move it. The way back is the chips themselves. */}
                    <span className="fhint">
                      {toneTouched
                        ? "your pick — it stays put if you change what kind of film this is"
                        : `following ${getCategory(category).label} — change it and it stays where you put it`}
                    </span>
                  </label>
                  <input type="hidden" name="tone" value={tone} />
                  <div className="chiprow" role="group" aria-label="Tone">
                    {TONES.map((t) => (
                      <button
                        type="button"
                        key={t}
                        className={`pchip ${tone === t ? "on" : ""}`}
                        onClick={() => {
                          setTone(t);
                          setToneTouched(true);
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field" style={{ marginTop: 18 }}>
                  <label>
                    Reference scripts{" "}
                    <span className="fhint">
                      optional — up to 3 from your library; the writer imitates their rhythm and voice
                    </span>
                  </label>
                  <StyleRefPicker tone={tone} />
                </div>
                <div className="field" style={{ marginTop: 18 }}>
                  <label htmlFor="style">Look</label>
                  <div className="chiprow" role="group" aria-label="Look">
                    {LOOKS.map((l) => (
                      <button
                        type="button"
                        key={l}
                        className={`pchip ${style === l ? "on" : ""}`}
                        onClick={() => setStyle(style === l ? "" : l)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  {/* The chips are shortcuts INTO this field, never a
                      replacement for it — the posted `style` is whatever
                      ends up here, so a written look survives untouched. */}
                  <input
                    id="style"
                    name="style"
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    placeholder="…or describe it: photorealistic, golden hour, 35mm"
                    style={{ marginTop: 10 }}
                    autoComplete="off"
                  />
                </div>
                <div className="field" style={{ marginTop: 18 }}>
                  <label>Pace</label>
                  {/* Two posted values from one control. `pace` is the WORD and
                      part of the frozen webhook contract — Claude Scripting
                      interpolates it into two writing prompts. `speed` is the
                      exact rate the render re-times the finished film to, and
                      it is what makes this control change the film at all.

                      The word is DERIVED from the rate rather than held
                      separately, so the two cannot contradict each other: there
                      is no way to post Pace: Slow alongside a speed of 1.1. */}
                  <input type="hidden" name="pace" value={pace} />
                  <input type="hidden" name="speed" value={speed} />
                  <SpeedPicker value={speed} onChange={setSpeed} />
                </div>
                <div className="frow">
                  <label>Video quality</label>
                  {/* Which Veo tier generates the clips. The pipeline has read
                      this override since 2026-09-03; the form is the first
                      thing to actually write it — until now every film ran on
                      the weakest (free) model, which is where the ghost cars
                      and driverless starts came from. The cost line is this
                      film's own arithmetic, so the trade is priced before it
                      is bought. */}
                  <input type="hidden" name="video_model" value={videoModel} />
                  <div className="seg" role="group" aria-label="Video quality">
                    {VIDEO_TIERS.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        className={videoModel === t.id ? "on" : ""}
                        onClick={() => setVideoModel(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="fnote">
                    {(() => {
                      const t = VIDEO_TIERS.find((x) => x.id === videoModel)!;
                      const clips = Math.max(1, Math.round(length / 8));
                      // The teaser's 3-5 shots render on Fast (10 credits
                      // each) whatever the body runs on — see Current Scene.
                      const hookExtra = t.credits === 0 && !noHook ? 40 : 0;
                      const total = clips * t.credits + hookExtra;
                      return t.credits === 0
                        ? `Free tier — clips cost no credits${noHook ? "" : " (the opening teaser's few shots still render on Fast, ~40 credits)"}. Fine for scenery and slow shots; complex motion (races, crowds, physical contact) is where it glitches.`
                        : `${t.note} ≈ ${total.toLocaleString("en-US")} credits for this film (${clips} clips × ${t.credits}), out of 25,050/month.`;
                    })()}
                  </p>
                </div>
                <div className="frow">
                  <label>Clip generation</label>
                  {/* Three Google Flow accounts are linked, and until this
                      control existed nothing on the site could reach them —
                      the two keys had to be typed into Editing Options by
                      hand. They move TOGETHER because apart neither does what
                      the producer asked for: flow_accounts alone only spreads
                      the scenes so useapi stops answering 429, and video_pool
                      is the half that actually keeps several Veo jobs in
                      flight. Clamped again in actions.ts. */}
                  <input
                    type="hidden"
                    name="flow_accounts"
                    value={parallelClips ? String(FLOW_ACCOUNTS_MAX) : "1"}
                  />
                  <input
                    type="hidden"
                    name="video_pool"
                    value={parallelClips ? "yes" : "no"}
                  />
                  <div className="seg" role="group" aria-label="Clip generation">
                    <button
                      type="button"
                      className={parallelClips ? "" : "on"}
                      onClick={() => setParallelClips(false)}
                    >
                      One at a time
                    </button>
                    <button
                      type="button"
                      className={parallelClips ? "on" : ""}
                      onClick={() => setParallelClips(true)}
                    >
                      All accounts at once
                    </button>
                  </div>
                  <p className="fnote">
                    {parallelClips
                      ? `The scenes are cut into ${FLOW_ACCOUNTS_MAX} blocks, one per linked account, and a clip is kept generating on each at the same time. Measured on nine scenes: 10 minutes, against 13 one at a time. Two things worth knowing — a film whose character sheets and set plates come from an earlier pass drops back to one account by itself rather than risk mismatched references, and while the accounts run together the SLOWEST one decides when the film is done.`
                      : `One clip is generated, then the next. Slower, and how every film has been made so far — pick this if anything looks wrong with the parallel runs.`}
                  </p>
                </div>
              </section>

              <section className="fsec">
                <header>
                  <h2>Who narrates it</h2>
                  <span className="no">03</span>
                </header>
                <CategoryPicker
                  part="voices"
                  preferredVoice={series?.voiceId}
                  onMeta={setCatMeta}
                  language={language}
                  selected={category}
                  onSelected={setCategory}
                  values={catValues}
                  onValues={setCatValues}
                />
                <div className="field" style={{ marginTop: 18 }}>
                  <label>Language</label>
                  {/* The film's ONE language control. n8n only ever
                      interpolates this value into prompts (never compares
                      it), so the English name is what gets posted, while the
                      list shows the endonym and the ISO code. */}
                  <input type="hidden" name="language" value={languageName} />
                  <LanguagePicker value={language} onChange={setLanguage} />
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--dim)" }}>
                    The script is written and narrated in this language, and it
                    is what the voice pickers are narrowed to.
                  </p>
                </div>
                {/* Absent on a silent film, not disabled: there is no
                    narration to give a character to, and a control that cannot
                    change the outcome reads as a decision. */}
                {!silent && (
                  <div className="field" style={{ marginTop: 18 }}>
                    <label>Voice character</label>
                    {/* One field carrying the whole choice as JSON, and an
                        EMPTY string when the producer left it alone. Every
                        other option on this form is a scalar, but this one has
                        a meaningful "unset" that four separate numbers cannot
                        express — and unset is what keeps each voice's own
                        tuning. */}
                    <input
                      type="hidden"
                      name="voice_tone"
                      value={voiceTone ? JSON.stringify(voiceTone) : ""}
                    />
                    <VoiceTonePicker
                      value={voiceTone}
                      onChange={setVoiceTone}
                      footnote="Applies to every line this film records. You can change it at the audio step and re-record, once you have heard it."
                    />
                  </div>
                )}
              </section>

              <section className="fsec">
                <header>
                  <h2>How long</h2>
                  <span className="no">04</span>
                </header>
                <div className="field">
                  <div className="lenhead">
                    <b>{lengthLabel}</b>
                    <span className="m">
                      {length} seconds · {scenes} scene{scenes === 1 ? "" : "s"}
                    </span>
                    {/* The named field. The slider drives it; this takes the
                        exact second the slider's 5s step cannot reach. The
                        "sec" beside it exists because without a unit the box
                        read as a display, not an input — the producer asked
                        for direct typing while already looking at it. */}
                    <span className="lenexact">
                      <input
                        id="length"
                        name="length"
                        type="number"
                        min={LENGTH_MIN}
                        max={LENGTH_MAX}
                        step={1}
                        value={length}
                        onChange={(e) => setLength(Number(e.target.value) || 0)}
                        required
                        aria-label="Length in seconds"
                      />
                      sec
                    </span>
                  </div>
                  <input
                    type="range"
                    className="lenslider"
                    min={LENGTH_MIN}
                    max={LENGTH_MAX}
                    step={5}
                    value={sliderPos}
                    onChange={(e) => setLength(Number(e.target.value))}
                    style={{ ["--fill" as string]: sliderFill }}
                    aria-label="Length"
                  />
                  <div className="chiprow" role="group" aria-label="Length presets">
                    {LENGTH_PRESETS.map((p) => (
                      <button
                        type="button"
                        key={p.s}
                        className={`pchip ${length === p.s ? "on" : ""}`}
                        onClick={() => setLength(p.s)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* Format has a card of its own. It rode along at the bottom of
                  "How long" as a 30px-tall segmented control, which is the
                  wrong weight for it twice over: it is the one choice on this
                  form that cannot be changed afterwards — every image, every
                  clip and the render itself are made to it — and it has
                  nothing to do with duration. The two options DRAW the frame
                  they mean, at a shared height so the difference in width is
                  the whole message; a word cannot say "this shape" as fast as
                  the shape can. */}
              <section className="fsec">
                <header>
                  <h2>Format</h2>
                  <span className="fhint">fixed once production starts</span>
                  <span className="no">05</span>
                </header>
                <div className="field">
                  <input type="hidden" name="aspect" value={aspect} />
                  <div className="optcards" role="group" aria-label="Format">
                    <button
                      type="button"
                      className={`optcard ${aspect === "16:9" ? "on" : ""}`}
                      onClick={() => setAspect("16:9")}
                      aria-pressed={aspect === "16:9"}
                    >
                      <span className="fmtbox wide" />
                      <b>16:9 horizontal</b>
                      <span>
                        YouTube and anything watched on a screen held sideways.
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`optcard ${aspect === "9:16" ? "on" : ""}`}
                      onClick={() => setAspect("9:16")}
                      aria-pressed={aspect === "9:16"}
                    >
                      <span className="fmtbox tall" />
                      <b>9:16 vertical</b>
                      <span>
                        Shorts, Reels and TikTok — the phone held upright.
                      </span>
                    </button>
                  </div>
                </div>
              </section>

              <section className="fsec">
                <header>
                  <h2>Finishes</h2>
                  <span className="fhint">changeable until the final render</span>
                  <span className="no">06</span>
                </header>
                <div className="swlist">
                  {/* Source labels are a Documentary feature (2026-09-19, the
                      producer's call): every other category is wall-to-wall AI,
                      so the badge drew one continuous AI GENERATED pill for the
                      whole film and distinguished nothing. Dropped rather than
                      disabled — and here, unlike at Final touches, no note is
                      needed: the category control is a few rows up on this same
                      screen, so picking Documentary brings the row straight
                      back. The value is still POSTED, so switching category
                      back and forth keeps what was chosen. */}
                  {FINISHES.filter(
                    (f) => !(f.name === "source_watermark" && category !== "documentary"),
                  ).map((f, i) => {
                    const disabled = silent && f.name === "captions";
                    const on = !disabled && finishes[f.name];
                    return (
                      <div key={f.name} className={`swrow ${on ? "on" : ""}`}>
                        <span className="no">{String(i + 1).padStart(2, "0")}</span>
                        <div>
                          <h4>{f.label}</h4>
                          <p>
                            {disabled
                              ? "No spoken words in this category — captions don't apply."
                              : on
                                ? f.on
                                : f.off}
                          </p>
                          {/* Only under SFX, and only while it is on: a
                              volume control for something that is switched
                              off is a decision with no subject. The value is
                              posted either way, so toggling off and back on
                              keeps the level the producer chose. */}
                          {f.name === "captions" && on && (
                            <CaptionColorPicker
                              value={captionColor}
                              onChange={setCaptionColor}
                            />
                          )}
                          {/* Same rule as the volumes below: the choice is
                              only shown while the badge is on, because how
                              often a label opens when there is no label is a
                              decision with no subject. The value is posted
                              either way, so switching the watermark off and
                              back on keeps what the producer picked. */}
                          {f.name === "source_watermark" && on && (
                            <div style={{ marginTop: 10 }}>
                              <WatermarkOpenPicker
                                value={watermarkOpenOnce}
                                onChange={setWatermarkOpenOnce}
                              />
                              <div style={{ marginTop: 14 }}>
                                <WatermarkSizePicker
                                  value={watermarkScale}
                                  onChange={setWatermarkScale}
                                  portrait={aspect === "9:16"}
                                  /* The full preview below already ends in an
                                     actual-size strip. */
                                  sample={false}
                                />
                              </div>
                              {/* The SAME preview Final touches uses, on three
                                  example shots over a blank frame — the brief
                                  is specifying a film that does not exist, so
                                  there is no still to put under it. One
                                  component rather than two: a preview that
                                  behaved differently on the two screens that
                                  own this decision would be two features. */}
                              <div style={{ marginTop: 14 }}>
                                <WatermarkPreview
                                  scenes={SAMPLE_SCENES}
                                  aspectRatio={aspect}
                                  showLabel
                                  openOncePerOrigin={watermarkOpenOnce}
                                  scale={watermarkScale}
                                  sample
                                />
                              </div>
                            </div>
                          )}
                          {f.name === "sfx" && on && (
                            <div style={{ marginTop: 10 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "baseline",
                                  justifyContent: "space-between",
                                  fontSize: 12,
                                  color: "var(--dim)",
                                }}
                              >
                                <label htmlFor="sfx_level_range">Effects volume</label>
                                <b style={{ color: "var(--ink)", fontFamily: "var(--f-mono), ui-monospace, monospace" }}>
                                  {sfxLevel}%
                                </b>
                              </div>
                              <input
                                id="sfx_level_range"
                                type="range"
                                className="lenslider"
                                min={SFX_LEVEL_PCT_MIN}
                                max={100}
                                step={5}
                                value={sfxLevel}
                                onChange={(e) => setSfxLevel(Number(e.target.value))}
                                style={{
                                  margin: "8px 0 2px",
                                  ["--fill" as string]: `${((sfxLevel - SFX_LEVEL_PCT_MIN) / (100 - SFX_LEVEL_PCT_MIN)) * 100}%`,
                                }}
                                aria-label="Effects volume"
                              />
                              <p style={{ margin: 0, fontSize: 11.5 }}>
                                {sfxLevel <= 20
                                  ? "Barely there — atmosphere you notice only in the gaps."
                                  : sfxLevel <= 50
                                    ? "Under the voice, clearly audible. The narration still leads."
                                    : "Forward and loud. The mix ducks it whenever the narrator speaks."}
                              </p>
                            </div>
                          )}
                          {f.name === "music" && on && (
                            <div style={{ marginTop: 10 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "baseline",
                                  justifyContent: "space-between",
                                  fontSize: 12,
                                  color: "var(--dim)",
                                }}
                              >
                                <label htmlFor="music_level_range">Music volume</label>
                                <b style={{ color: "var(--ink)", fontFamily: "var(--f-mono), ui-monospace, monospace" }}>
                                  {musicLevel}%
                                </b>
                              </div>
                              <input
                                id="music_level_range"
                                type="range"
                                className="lenslider"
                                min={MUSIC_LEVEL_PCT_MIN}
                                max={100}
                                step={1}
                                value={musicLevel}
                                onChange={(e) => setMusicLevel(Number(e.target.value))}
                                style={{
                                  margin: "8px 0 2px",
                                  ["--fill" as string]: `${((musicLevel - MUSIC_LEVEL_PCT_MIN) / (100 - MUSIC_LEVEL_PCT_MIN)) * 100}%`,
                                }}
                                aria-label="Music volume"
                              />
                              <p style={{ margin: 0, fontSize: 11.5 }}>
                                {musicLevel <= 15
                                  ? "A whisper of a bed — felt more than heard."
                                  : musicLevel <= 35
                                    ? "Under the voice, clearly there. The narration still leads."
                                    : "Forward and loud. The mix ducks it whenever the narrator speaks."}
                              </p>
                            </div>
                          )}
                        </div>
                        <input type="hidden" name={f.name} value={on ? "yes" : "no"} />
                        <Toggle
                          checked={on}
                          disabled={disabled}
                          ariaLabel={f.label}
                          onChange={(v) => setFinishes((p) => ({ ...p, [f.name]: v }))}
                        />
                      </div>
                    );
                  })}
                  {/* Posted as the 0–1 gain the mixer takes, not as the
                      percentage the slider shows — one unit in the pipeline,
                      converted once, here at the edge. */}
                  <input
                    type="hidden"
                    name="sfx_level"
                    value={(sfxLevel / 100).toFixed(2)}
                  />
                  <input
                    type="hidden"
                    name="music_level"
                    value={(musicLevel / 100).toFixed(2)}
                  />
                  <input type="hidden" name="caption_color" value={captionColor} />
                  {/* The node reads `yes`, and STRICTLY that — see the
                      orchestrator's Normalize Webhook Input. Posted whatever
                      the watermark switch says, like the two levels above. */}
                  <input
                    type="hidden"
                    name="watermark_open_once"
                    value={watermarkOpenOnce ? "yes" : "no"}
                  />
                  {/* The multiplier itself, not a percentage: the same unit
                      `Normalize Webhook Input`, derive.ts and the render all
                      refuse out of range. */}
                  <input
                    type="hidden"
                    name="watermark_scale"
                    value={watermarkScale}
                  />
                </div>
                <div className="frow" style={{ marginTop: 18 }}>
                  <label>Animation style</label>
                  <input type="hidden" name="motion_pack" value={motionPacksFor(category).some((p) => p.id === motionPack) ? motionPack : ""} />
                  <div className="seg" role="group" aria-label="Animation style" style={{ flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={!motionPacksFor(category).some((p) => p.id === motionPack) ? "on" : ""}
                      onClick={() => setMotionPack("")}
                    >
                      Auto · {MOTION_PACKS.find((p) => p.id === defaultMotionPackFor(category))?.label}
                    </button>
                    {motionPacksFor(category).map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        className={motionPack === p.id ? "on" : ""}
                        onClick={() => setMotionPack(p.id)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="fnote">
                    {motionPack === ""
                      ? "How captions and chapter titles move. Auto follows the film's category. Changeable in Final touches."
                      : MOTION_PACKS.find((p) => p.id === motionPack)?.hint}
                  </p>
                </div>
                {offersGraphicStyle(category) && (
                <div className="frow" style={{ marginTop: 18 }}>
                  <label>Graphics</label>
                  {/* A pick from another category (the category changed after
                      it was made) is not this film's: it reads as AI picks. */}
                  <input type="hidden" name="graphic_style" value={graphicStylesFor(category).some((g) => g.id === graphicStyle) ? graphicStyle : ""} />
                  <div className="seg" role="group" aria-label="Graphics" style={{ flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={!graphicStylesFor(category).some((g) => g.id === graphicStyle) ? "on" : ""}
                      onClick={() => setGraphicStyle("")}
                    >
                      ✨ AI picks
                    </button>
                    {graphicStylesFor(category).map((g) => (
                      <button
                        type="button"
                        key={g.id}
                        className={graphicStyle === g.id ? "on" : ""}
                        onClick={() => setGraphicStyle(g.id)}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                  <p className="fnote">
                    {!graphicStylesFor(category).some((g) => g.id === graphicStyle)
                      ? "Graphics over the footage — titles, names, bubbles, slates, depending on the kind of film. The AI picks a style by the film's theme once the scenes are written. Changeable in Final touches."
                      : GRAPHIC_STYLES.find((g) => g.id === graphicStyle)?.hint}
                  </p>
                </div>
                )}
                <div className="frow" style={{ marginTop: 18 }}>
                  <label>Transitions</label>
                  <input type="hidden" name="transition_style" value={transitionStyle} />
                  <div className="seg" role="group" aria-label="Transitions" style={{ flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={transitionStyle === "" ? "on" : ""}
                      onClick={() => setTransitionStyle("")}
                    >
                      ✨ AI picks
                    </button>
                    {TRANSITION_STYLES.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        className={transitionStyle === t.id ? "on" : ""}
                        onClick={() => setTransitionStyle(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="fnote">
                    {transitionStyle === ""
                      ? "How the picture hands over at a few cuts — never at every one. The AI picks a family by the film's theme. Changeable in Final touches."
                      : TRANSITION_STYLES.find((t) => t.id === transitionStyle)?.hint}
                  </p>
                </div>
                {!noHook && (
                <div className="frow" style={{ marginTop: 18 }}>
                  <label>Cold open</label>
                  {/* Every film opens on a teaser of a few fast shots now —
                      the old opening title card is retired. This only decides
                      the teaser's STYLE, and the AI's own pick is the default;
                      a silent film can only take a silent style, so the list
                      narrows for it (Voice Mode applies the same rule). */}
                  <input type="hidden" name="hook_style" value={hookStyle} />
                  <div className="seg" role="group" aria-label="Cold open style" style={{ flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={hookStyle === "auto" ? "on" : ""}
                      onClick={() => setHookStyle("auto")}
                    >
                      AI picks
                    </button>
                    {HOOK_STYLES.filter((h) => !silent || h.silent).map((h) => (
                      <button
                        type="button"
                        key={h.id}
                        className={hookStyle === h.id ? "on" : ""}
                        onClick={() => setHookStyle(h.id)}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                  <p className="fnote">
                    {hookStyle === "auto"
                      ? "Scripting reads the story and opens it the way that fits — a spoken teaser for most films, a silent slate or cliffhanger where the story asks for one. Changeable after the script is written, hook only."
                      : HOOK_STYLES.find((h) => h.id === hookStyle)?.blurb}
                  </p>
                </div>
                )}
              </section>

              <section className="fsec">
                <header>
                  <h2>Canon &amp; reference</h2>
                  <span className="fhint">optional</span>
                  <span className="no">07</span>
                </header>
                <div className="field">
                  <label htmlFor="lore">Lore / canon context</label>
                  <textarea
                    id="lore"
                    name="lore"
                    className="nb-ta"
                    rows={4}
                    maxLength={8000}
                    placeholder="For niche topics (Backrooms levels, SCP, game/franchise lore): paste the actual wiki/canon details here. The script treats this as ground truth — names, entities and mechanics come from this text, not invented."
                    style={{ resize: "vertical" }}
                  />
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>
                    Leave empty for well-known topics — the AI&apos;s own
                    knowledge is enough for history, science, brands etc.
                  </p>
                </div>
                <div className="field" style={{ marginTop: 16 }}>
                  <label htmlFor="reference_image">Reference image for the first scene</label>
                  <input
                    type="file"
                    id="reference_image"
                    name="reference_image"
                    accept="image/jpeg,image/png,image/webp"
                  />
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>
                    Optional — upload a photo and the first scene&apos;s image
                    is generated FROM it: the exact subject, design and look are
                    treated as ground truth (ex. your car, your product, a real
                    place). The rest of the film chains off that first frame.
                    JPG/PNG/WebP, max 6&nbsp;MB.
                  </p>
                </div>
              </section>

              <section className="fsec">
                <header>
                  <h2>Hands-off</h2>
                  <span className="fhint">optional — you can turn it off any time</span>
                  <span className="no">08</span>
                </header>
                <input type="hidden" name="auto_approve_steps" value={autoApprove ? autoSteps.join(",") : ""} />
                <div className="swlist">
                  <div className={`swrow ${autoApprove ? "on" : ""}`}>
                    <span className="no">01</span>
                    <div>
                      <h4>Auto-approve</h4>
                      <p>
                        {!autoApprove
                          ? "The film stops at every gate and waits for your approval — the normal way."
                          : autoAll
                            ? "Every gate — script, scenes, takes, images, clips — signs itself off the moment its asset lands, and the final render starts by itself. Nothing waits for you, and nothing gets a look first. Works while the project page is open in a tab; regenerating anything still works as usual."
                            : `${describeAutoSteps(autoShown)} ${autoShown.length === 1 ? "signs off by itself the moment its asset lands" : "sign off by themselves the moment their assets land"}; every other step waits for you. Works while the project page is open in a tab.`}
                      </p>
                    </div>
                    <Toggle
                      checked={autoApprove}
                      ariaLabel="Auto-approve"
                      onChange={(on) => setAutoSteps(on ? [...AUTO_STEPS] : [])}
                    />
                  </div>
                </div>
                {/* Which steps. Shown only while the switch is on, because
                    with it off there is nothing to choose; untick the last
                    step and the switch goes off with it. "All" is the old
                    switch's meaning in one click. */}
                {autoApprove && (
                  <div className="field" style={{ marginTop: 12 }}>
                    <label>
                      Which steps{" "}
                      <span className="fhint">the rest wait for you — you can add any step later from its page</span>
                    </label>
                    <div className="chiprow" role="group" aria-label="Steps that approve themselves">
                      <button
                        type="button"
                        className={`pchip ${autoAll ? "on" : ""}`}
                        aria-pressed={autoAll}
                        onClick={() => setAutoSteps(autoAll ? [] : [...AUTO_STEPS])}
                      >
                        All
                      </button>
                      {autoChoices.map((st) => (
                        <button
                          type="button"
                          key={st}
                          className={`pchip ${autoSteps.includes(st) ? "on" : ""}`}
                          aria-pressed={autoSteps.includes(st)}
                          onClick={() =>
                            setAutoSteps((cur) => {
                              const next = withAutoStep(cur, st, !cur.includes(st));
                              // Nothing left that this film can have: off.
                              return next.some((x) => autoChoices.includes(x)) ? next : [];
                            })
                          }
                        >
                          {AUTO_STEP_LABELS[st]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* The estimate. Inside the <form>, so its submit button submits;
                sticky, so it travels with the page as the brief is filled. */}
            <aside className="rail">
              <div className="nb-est">
                <span className="dpill">
                  <i />
                  Estimate · fills in as you type
                </span>
                <div
                  className={`sprev ${name ? "" : "blank"} ${tt.className}`}
                  style={tt.uppercase ? { textTransform: "uppercase" } : undefined}
                >
                  {name || "Untitled film"}
                </div>
                <p className="blurb">
                  {tone.toLowerCase()} · {pace.toLowerCase()} pace ·{" "}
                  {(VOICE_LABELS[catMeta.voiceMode] ?? catMeta.voiceMode).toLowerCase()},
                  in {languageName}. The title above is set in the exact typeface
                  your film&apos;s titles will use for this tone.
                </p>
                <dl className="rows">
                  <div>
                    <dt>Category</dt>
                    <dd>
                      {catMeta.categoryLabel}
                      {!catMeta.ready && " · in development"}
                    </dd>
                  </div>
                  <div>
                    <dt>Finished length</dt>
                    <dd>
                      {lengthLabel} · {scenes} scene{scenes === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt>Narration</dt>
                    <dd>≈ {words.toLocaleString()} words</dd>
                  </div>
                  <div>
                    <dt>Chapters</dt>
                    <dd>{chapters}</dd>
                  </div>
                  <div>
                    <dt>Format</dt>
                    <dd>{aspect === "9:16" ? "9:16 vertical" : "16:9 horizontal"}</dd>
                  </div>
                  <div>
                    <dt>Finishes</dt>
                    <dd className={finishList ? "" : "off"}>{finishList || "None — bare cut"}</dd>
                  </div>
                  <div>
                    <dt>Approval gates</dt>
                    <dd>
                      {!autoApprove
                        ? `${gates} — script, images${silent ? "" : ", voices"}, clips`
                        : autoAll
                          ? "auto — signed off as they land"
                          : `auto: ${describeAutoSteps(autoShown)} · the rest wait for you`}
                    </dd>
                  </div>
                </dl>

                {state && (
                  <p className={`formmsg ${state.ok ? "ok" : "err"}`}>{state.message}</p>
                )}

                {/* The only way to start a film. Explicitly type="submit" —
                    the form deliberately blocks Enter, so the one control that
                    IS meant to submit should say so where a reader sees it. */}
                {/* Blocked until somebody owns the film. A name that can be
                    skipped is a name that gets skipped, and a scoreboard with
                    holes in it is not one — so this is a gate rather than a
                    nudge. The reason is stated right here, under the one
                    control it stops, because the chips are a screen away. */}
                <button type="submit" className="go" disabled={pending || !createdBy}>
                  {pending ? "Starting…" : "Start production"}
                </button>
                <span className="csnote">
                  {createdBy
                    ? "You approve the script before a single frame is rendered."
                    : "Pick who is making this at the top of the brief first."}
                </span>
              </div>
            </aside>
          </div>
        </form>
      </div>

      <footer className="nb-foot">
        <span className="brandline" style={{ fontSize: 15 }}>
          <span className="bmark" aria-hidden="true" />
          House of Videos
        </span>
        <span>Brief → script → scenes → film</span>
      </footer>
    </main>
  );
}
