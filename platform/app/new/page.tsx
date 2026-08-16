"use client";

import { useActionState, useState } from "react";
import { createProject, type ActionResult } from "@/app/actions";
import CategoryPicker, { type CategoryMeta } from "@/components/CategoryPicker";
import { DEFAULT_CATEGORY, getCategory } from "@/lib/categories";
import Toggle from "@/components/Toggle";
import FormProgress from "@/components/FormProgress";
import LanguagePicker from "@/components/LanguagePicker";
import { languageByCode } from "@/lib/languages";
import { toneType } from "@/lib/tone-type";

async function submit(_prev: ActionResult | null, formData: FormData) {
  return createProject(formData);
}

// Same option set as the n8n form — the site fully replaces it.
const TONES = [
  "Epic",
  "Educativ",
  "Cinematic",
  "Corporate",
  "Emotional",
  "Dark",
  "Conspiracy",
  "Horror",
  "Dramatic",
  "Documentary",
  "Motivational",
];

const PACES = ["Slow", "Normal", "Fast"];

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

/** Length presets, in seconds. The slider snaps to 8s — one scene. */
const LENGTH_PRESETS = [
  { label: "32s", s: 32 },
  { label: "1 min", s: 64 },
  { label: "2 min", s: 120 },
  { label: "4 min", s: 240 },
  { label: "8 min", s: 480 },
];

/**
 * The overlay finishes, as numbered switch rows. Field names and yes/no
 * values are the exact strings createProject() forwards to n8n — the
 * redesign must never change that contract.
 */
const FINISHES: Array<{
  name: "captions" | "hook_title" | "chapter_cards" | "end_screen" | "sfx" | "music";
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
  {
    name: "hook_title",
    label: "Opening title",
    sheet: "Hook",
    on: "The hook line types itself over the first scene",
    off: "Clean opening, straight into the story",
    default: true,
  },
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
    name: "music",
    label: "Music",
    sheet: "Music",
    on: "Background track plus whoosh/boom accents at the cuts",
    off: "No added music or accents",
    default: false,
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
 */
export default function NewVideo() {
  const [state, formAction, pending] = useActionState(submit, null);
  const [name, setName] = useState("");
  const [tone, setTone] = useState("Dark");
  const [length, setLength] = useState(64);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [pace, setPace] = useState("Normal");
  // The language as an ISO code — the picker's own currency. What n8n gets
  // is the English name, below.
  const [language, setLanguage] = useState("en");
  const [finishes, setFinishes] = useState<Record<string, boolean>>(
    Object.fromEntries(FINISHES.map((f) => [f.name, f.default])),
  );
  const [style, setStyle] = useState("");
  // The category selection lives here because BOTH halves of CategoryPicker
  // read it and they are rendered in different cards.
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [catValues, setCatValues] = useState<Record<string, string | boolean>>({});
  const [catMeta, setCatMeta] = useState<CategoryMeta>({
    category: DEFAULT_CATEGORY,
    categoryLabel: getCategory(DEFAULT_CATEGORY).label,
    voiceMode: "off",
    ready: getCategory(DEFAULT_CATEGORY).ready,
  });

  const lang = languageByCode(language);
  const languageName = lang?.name ?? "English";
  const scenes = Math.max(1, Math.round(length / 8));
  const words = scenes * 22;
  const chapters = Math.max(1, Math.ceil(length / 120));
  const tt = toneType(tone);
  const silent = catMeta.voiceMode === "silent";
  const gates = silent ? 3 : 4;
  const finishList = FINISHES.filter(
    (f) => finishes[f.name] && !(silent && f.name === "captions"),
  )
    .map((f) => f.sheet)
    .join(" · ");
  const lengthLabel = `${Math.floor(length / 60)}:${String(length % 60).padStart(2, "0")}`;
  const sliderFill = `${(Math.min(Math.max(length, 16), 480) - 16) / (480 - 16) * 100}%`;

  return (
    <main className="page nb">
      <div className="nb-shell">
        <div className="arc" aria-hidden="true" />

        <div className="nb-head">
          <span className="nb-pill">
            <i />
            New project
          </span>
          <h1>Start a video</h1>
          <p>
            Fill in the brief and the pipeline takes it from there. Everything
            after this happens without you — until the script and the scenes
            come back for approval.
          </p>
        </div>

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
              <FormProgress />

              <section className="fsec" style={{ marginTop: 0 }}>
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
                    maxLength={140}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--dim)" }}>
                    Keep it short — it becomes the title shown in the video.
                    Style details go in the Look field, not here.
                  </p>
                  <div className="sugrow" aria-label="Suggestions">
                    {SUGGESTIONS.map((sg) => (
                      <button type="button" key={sg} className="sug" onClick={() => setName(sg)}>
                        {sg}
                      </button>
                    ))}
                  </div>
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
                  <label>Tone</label>
                  <input type="hidden" name="tone" value={tone} />
                  <div className="chiprow" role="group" aria-label="Tone">
                    {TONES.map((t) => (
                      <button
                        type="button"
                        key={t}
                        className={`pchip ${tone === t ? "on" : ""}`}
                        onClick={() => setTone(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
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
                  <input type="hidden" name="pace" value={pace} />
                  <div className="seg" role="group" aria-label="Pace">
                    {PACES.map((p) => (
                      <button
                        type="button"
                        key={p}
                        className={pace === p ? "on" : ""}
                        onClick={() => setPace(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="fsec">
                <header>
                  <h2>Who narrates it</h2>
                  <span className="no">03</span>
                </header>
                <CategoryPicker
                  part="voices"
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
                    {/* The named field. The slider drives it; this allows an
                        exact number the slider's 8s snap cannot reach. */}
                    <input
                      id="length"
                      name="length"
                      type="number"
                      min={16}
                      max={480}
                      step={1}
                      value={length}
                      onChange={(e) => setLength(Number(e.target.value) || 0)}
                      required
                      aria-label="Length in seconds"
                    />
                  </div>
                  <input
                    type="range"
                    className="lenslider"
                    min={16}
                    max={480}
                    step={8}
                    value={Math.min(Math.max(length, 16), 480)}
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

              <section className="fsec">
                <header>
                  <h2>Finishes</h2>
                  <span className="fhint">changeable until the final render</span>
                  <span className="no">05</span>
                </header>
                <div className="swlist">
                  {FINISHES.map((f, i) => {
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
                </div>
              </section>

              <section className="fsec">
                <header>
                  <h2>Canon &amp; reference</h2>
                  <span className="fhint">optional</span>
                  <span className="no">06</span>
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
                    <dt>Look</dt>
                    <dd className={style ? "" : "off"}>{style || "unset"}</dd>
                  </div>
                  <div>
                    <dt>Finishes</dt>
                    <dd className={finishList ? "" : "off"}>{finishList || "None — bare cut"}</dd>
                  </div>
                  <div>
                    <dt>Approval gates</dt>
                    <dd>
                      {gates} — script, images{silent ? "" : ", voices"}, clips
                    </dd>
                  </div>
                </dl>

                {/* Format lives in the rail: it is a property of the delivered
                    file, which is what this panel describes. */}
                <div className="field" style={{ marginTop: 16 }}>
                  <input type="hidden" name="aspect" value={aspect} />
                  <div className="seg" role="group" aria-label="Format">
                    <button
                      type="button"
                      className={aspect === "16:9" ? "on" : ""}
                      onClick={() => setAspect("16:9")}
                    >
                      16:9
                    </button>
                    <button
                      type="button"
                      className={aspect === "9:16" ? "on" : ""}
                      onClick={() => setAspect("9:16")}
                    >
                      9:16
                    </button>
                  </div>
                </div>

                {state && (
                  <p className={`formmsg ${state.ok ? "ok" : "err"}`}>{state.message}</p>
                )}

                {/* The only way to start a film. Explicitly type="submit" —
                    the form deliberately blocks Enter, so the one control that
                    IS meant to submit should say so where a reader sees it. */}
                <button type="submit" className="go" disabled={pending}>
                  {pending ? "Starting…" : "Start production"}
                </button>
                <span className="csnote">
                  You approve the script before a single frame is rendered.
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
