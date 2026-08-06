"use client";

import { useActionState, useState } from "react";
import { createProject, type ActionResult } from "@/app/actions";
import CategoryPicker, { type CategoryMeta } from "@/components/CategoryPicker";
import Toggle from "@/components/Toggle";
import FormProgress from "@/components/FormProgress";
import GenreSpiral from "@/components/GenreSpiral";
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
  characters: "Character cast",
  chapters: "Narrator per chapter",
};

/**
 * The brief. The form holds the centre; a live project preview sits to its
 * left, deliberately dimmed — it confirms what you typed rather than
 * competing for attention — and the right rail is held for illustrated
 * stickers. The preview's title uses the exact typeface the film's titles
 * will use for the chosen tone (lib/tone-type.ts mirrors the render's
 * presetForTone), so the site shows the film's own dress before a single
 * frame is produced.
 */
export default function NewVideo() {
  const [state, formAction, pending] = useActionState(submit, null);
  const [name, setName] = useState("");
  const [tone, setTone] = useState("Dark");
  const [length, setLength] = useState(64);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [pace, setPace] = useState("Normal");
  const [language, setLanguage] = useState("English");
  const [finishes, setFinishes] = useState<Record<string, boolean>>(
    Object.fromEntries(FINISHES.map((f) => [f.name, f.default])),
  );
  const [catMeta, setCatMeta] = useState<CategoryMeta>({
    category: "story",
    categoryLabel: "Story",
    voiceMode: "off",
    ready: true,
  });

  const scenes = Math.max(1, Math.round(length / 8));
  const tt = toneType(tone);
  const silent = catMeta.voiceMode === "silent";
  const finishList = FINISHES.filter(
    (f) => finishes[f.name] && !(silent && f.name === "captions"),
  )
    .map((f) => f.sheet)
    .join(" · ");

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

      <form action={formAction}>
        <div className="brief">
          {/* ---- the live project preview ---- */}
          <aside className="callsheet">
            <div className="eyebrow">
              <span>Project preview</span>
              <span className="sp" />
              <span className="n">LIVE</span>
            </div>
            <div className="slate">
              <div className="slabel">Title preview · {tone}</div>
              <div
                className={`sprev ${name ? "" : "blank"} ${tt.className}`}
                style={tt.uppercase ? { textTransform: "uppercase" } : undefined}
              >
                {name || "Untitled film"}
              </div>
              <div className="srule" />
            </div>
            <dl className="cs">
              <div>
                <dt>Category</dt>
                <dd>
                  {catMeta.categoryLabel}
                  {!catMeta.ready && <span style={{ color: "var(--dim)" }}> · in development</span>}
                </dd>
              </div>
              <div>
                <dt>Tone</dt>
                <dd>{tone}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>
                  {length || "—"}s · ≈{scenes} scene{scenes === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>{aspect === "9:16" ? "9:16 vertical" : "16:9 horizontal"}</dd>
              </div>
              <div>
                <dt>Voices</dt>
                <dd>{VOICE_LABELS[catMeta.voiceMode] ?? catMeta.voiceMode}</dd>
              </div>
              <div>
                <dt>Finishes</dt>
                <dd className={finishList ? "" : "off"}>{finishList || "None — bare cut"}</dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd>{language || "—"}</dd>
              </div>
              <div>
                <dt>Pace</dt>
                <dd>{pace}</dd>
              </div>
            </dl>
            <p className="csnote">
              This fills in as you type. The title above is set in the exact
              typeface your film&apos;s titles will use for this tone.
            </p>
          </aside>

          {/* ---- the form: the one thing on this page to fill in ---- */}
          <div className="form">
            <FormProgress />
            <section className="fsec" style={{ marginTop: 0 }}>
              <header>
                <span className="no">01</span>
                <h2>Subject</h2>
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
              </div>
              <div className="field" style={{ marginTop: 18 }}>
                <label htmlFor="language">Language</label>
                <input
                  id="language"
                  name="language"
                  list="langs"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  required
                />
                <datalist id="langs">
                  <option value="English" />
                  <option value="Română" />
                  <option value="Deutsch" />
                  <option value="Español" />
                  <option value="Français" />
                </datalist>
              </div>
            </section>

            <section className="fsec">
              <header>
                <span className="no">02</span>
                <h2>Format &amp; voices</h2>
              </header>
              <CategoryPicker onMeta={setCatMeta} />
              <div className="cols2" style={{ marginTop: 18 }}>
                <div className="field">
                  <label htmlFor="length">
                    Length (seconds) — ≈ {scenes} scenes of 8s
                  </label>
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
                  />
                </div>
                <div className="field">
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
              </div>
            </section>

            <section className="fsec">
              <header>
                <span className="no">03</span>
                <h2>Tone &amp; pace</h2>
                <span className="fhint">shapes writing · palette · type</span>
              </header>
              <div className="field">
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
                  palette, the music — and the typeface in the preview is the
                  one this tone puts on screen.
                </p>
              </div>
              <div className="field" style={{ marginTop: 16 }}>
                <label>Pace</label>
                <input type="hidden" name="pace" value={pace} />
                <div className="chiprow" role="group" aria-label="Pace">
                  {PACES.map((p) => (
                    <button
                      type="button"
                      key={p}
                      className={`pchip ${pace === p ? "on" : ""}`}
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
                <span className="no">04</span>
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
                <span className="no">05</span>
                <h2>Style &amp; canon</h2>
                <span className="fhint">optional</span>
              </header>
              <div className="field">
                <label htmlFor="style">Visual style</label>
                <input
                  id="style"
                  name="style"
                  placeholder="ex. photorealistic, golden hour, 35mm"
                />
              </div>
              <div className="field" style={{ marginTop: 16 }}>
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
            </section>

            {state && (
              <p className={`formmsg ${state.ok ? "ok" : "err"}`} style={{ marginTop: 24 }}>
                {state.message}
              </p>
            )}

            <div className="fsubmit">
              <button className="btn gold" disabled={pending} style={{ padding: "12px 26px" }}>
                {pending ? "Starting…" : "Start production"}
              </button>
            </div>
          </div>

          {/* Reserved for the illustrated stickers. Empty on purpose — it
              holds the form's centre line, so adding the art later won't
              shift a layout the producer has already learned. */}
          <aside className="briefart" aria-hidden="true">
            <GenreSpiral />
          </aside>
        </div>
      </form>
    </main>
  );
}
