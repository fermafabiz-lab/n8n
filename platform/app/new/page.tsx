"use client";

import { useActionState, useState } from "react";
import { createProject, type ActionResult } from "@/app/actions";
import CategoryPicker, { type CategoryMeta } from "@/components/CategoryPicker";
import Toggle from "@/components/Toggle";
import FormProgress from "@/components/FormProgress";
import GenreSpiral from "@/components/GenreSpiral";
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
  const [catMeta, setCatMeta] = useState<CategoryMeta>({
    category: "story",
    categoryLabel: "Story",
    voiceMode: "off",
    ready: true,
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
    <main className="page">
      <div className="hero titlescreen">
        <h1>
          Start a <em>new video</em>
        </h1>
        <p>
          Fill in the brief and the factory takes it from there. You&apos;ll be
          asked to review the script, then the images, then the videos.
        </p>
        <span className="scrollcue">The brief</span>
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
          // newline and never submits, and a button's Enter is that button's
          // own activation — so "Start production" still works from the
          // keyboard, and so do the tone chips and the finish toggles (all
          // type="button"). isComposing guards IME entry, where Enter commits
          // a candidate rather than reaching the form at all.
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
          {/* ---- the form: a stack of numbered cards ---- */}
          <div className="form">
            <FormProgress />
            <section className="fsec">
              <header>
                <span className="no">01</span>
                <h2>What is it about</h2>
              </header>
              <div className="field">
                <input
                  id="name"
                  name="name"
                  className="bigin"
                  placeholder="History of Germany in WW2"
                  maxLength={140}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--dim)" }}>
                  Keep it short — it becomes the title shown in the video.
                  Style details go in the Style field, not here.
                </p>
                <div className="sugrow" aria-label="Suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button type="button" key={s} className="sug" onClick={() => setName(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="fsec">
              <header>
                <span className="no">02</span>
                <h2>Format &amp; voices</h2>
              </header>
              <div className="field" style={{ marginBottom: 18 }}>
                <label>Language</label>
                {/* The film's ONE language control. n8n only ever interpolates
                    this value into prompts (never compares it), so the English
                    name is what gets posted — unambiguous to the writer model
                    — while the list shows the endonym and the ISO code. */}
                <input type="hidden" name="language" value={languageName} />
                <LanguagePicker value={language} onChange={setLanguage} />
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--dim)" }}>
                  The script is written and narrated in this language, and it is
                  what the voice pickers below are narrowed to.
                </p>
              </div>
              {/* The Language field lives just above, so the value is threaded
                  down rather than read from the DOM — both voice pickers
                  narrow to voices that speak it. */}
              <CategoryPicker onMeta={setCatMeta} language={language} />
              <div className="field" style={{ marginTop: 18 }}>
                <label>Format</label>
                <input type="hidden" name="aspect" value={aspect} />
                <div className="chiprow" role="group" aria-label="Format" style={{ paddingTop: 6 }}>
                  <button
                    type="button"
                    className={`pchip ${aspect === "16:9" ? "on" : ""}`}
                    onClick={() => setAspect("16:9")}
                  >
                    16:9 horizontal
                  </button>
                  <button
                    type="button"
                    className={`pchip ${aspect === "9:16" ? "on" : ""}`}
                    onClick={() => setAspect("9:16")}
                  >
                    9:16 vertical
                  </button>
                </div>
              </div>
            </section>

            <section className="fsec">
              <header>
                <span className="no">03</span>
                <h2>How it should feel</h2>
                <span className="fhint">shapes writing · palette · type</span>
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
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--dim)" }}>
                  Independent of the category: it shapes the writing, the
                  palette, the music — and the title in the estimate panel is
                  set in the typeface this tone puts on screen.
                </p>
              </div>
              <div className="field" style={{ marginTop: 16 }}>
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
              <div className="field" style={{ marginTop: 16 }}>
                <label htmlFor="style">Visual style</label>
                <input
                  id="style"
                  name="style"
                  placeholder="ex. photorealistic, golden hour, 35mm"
                />
              </div>
            </section>

            <section className="fsec">
              <header>
                <span className="no">04</span>
                <h2>How long</h2>
              </header>
              <div className="field">
                <div className="lenhead">
                  <b>{lengthLabel}</b>
                  <span className="m">
                    {length}s · ≈{scenes} scene{scenes === 1 ? "" : "s"} of 8s
                  </span>
                  {/* The named field. The slider drives it; this allows an
                      exact number the slider's 8s snap can't reach. */}
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
                <span className="no">05</span>
                <h2>Finishes</h2>
                <span className="fhint">changeable until the final render</span>
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
                <span className="no">06</span>
                <h2>Canon &amp; reference</h2>
                <span className="fhint">optional</span>
              </header>
              <div className="field">
                <label htmlFor="lore">Lore / canon context</label>
                <textarea
                  id="lore"
                  name="lore"
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
                <label htmlFor="reference_image">
                  Reference image for the first scene
                </label>
                <input
                  type="file"
                  id="reference_image"
                  name="reference_image"
                  accept="image/jpeg,image/png,image/webp"
                />
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>
                  Optional — upload a photo and the first scene&apos;s image is
                  generated FROM it: the exact subject, design and look are
                  treated as ground truth (ex. your car, your product, a real
                  place). The rest of the film chains off that first frame.
                  JPG/PNG/WebP, max 6&nbsp;MB.
                </p>
              </div>
            </section>
          </div>

          {/* ---- the rail: estimate (with the submit), pole, next steps.
               Inside the <form>, so the submit button below still submits. */}
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
                {(VOICE_LABELS[catMeta.voiceMode] ?? catMeta.voiceMode).toLowerCase()},{" "}
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
                    {gates} — script, images{silent ? "" : ", voices"}, clips
                  </dd>
                </div>
              </dl>

              {state && (
                <p className={`formmsg ${state.ok ? "ok" : "err"}`}>{state.message}</p>
              )}

              {/* The only way to start a film. Explicitly type="submit" — the
                  form deliberately blocks Enter, so the one control that IS
                  meant to submit should say so where a reader will see it. */}
              <button type="submit" className="go" disabled={pending}>
                {pending ? "Starting…" : "Start production"}
              </button>
              <span className="csnote">
                You approve the script before a single frame is rendered.
              </span>
            </div>

            <div className="railpole" aria-hidden="true">
              <GenreSpiral />
              <span className="polecap">Every look it can make</span>
            </div>

            <div className="nb-next">
              <span className="klabel">What happens next</span>
              {[
                { t: "The script arrives", b: "Chapters, then narration, then a scene plan." },
                { t: "You approve it", b: "Edit anything before a frame is made." },
                { t: "Scenes render", b: "Images, voices and motion, gate by gate." },
                { t: "The cut lands", b: "Stitched, graded and ready on the project page." },
              ].map((s) => (
                <div className="step" key={s.t}>
                  <i />
                  <div>
                    <b>{s.t}</b>
                    <p>{s.b}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </form>
    </main>
  );
}
