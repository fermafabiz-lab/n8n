"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmFinalSettings, requestGraphicPlan, type ActionResult } from "@/app/actions";
import Toggle from "@/components/Toggle";
import CaptionColorPicker from "@/components/CaptionColorPicker";
import WatermarkOpenPicker from "@/components/WatermarkOpenPicker";
import WatermarkSizePicker from "@/components/WatermarkSizePicker";
import WatermarkPreview, { type PreviewScene } from "@/components/WatermarkPreview";
import { useSetPendingStage } from "@/components/StageNav";
import type { EditingOptions, MotifCard } from "@/lib/data";
import { MOTION_PACKS, defaultMotionPackFor } from "@/lib/motion-packs";
import { GRAPHIC_STYLES, graphicStyleLabel, offersGraphicStyle } from "@/lib/graphic-styles";

/**
 * The last gate: every clip is approved and the batch is holding just before
 * final assembly. The overlay choices made when the project was created are
 * still changeable here — the graphics pass reads them from the project
 * record at render time — and confirming is what releases the batch.
 *
 * Deliberately built as a finishing screen rather than a settings form: the
 * default path is one click ("Keep initial settings"), and the toggles are
 * there for the rarer case where something should come off.
 */
/** Only the switch-shaped options belong in the list below. `keyof
 *  EditingOptions` is too wide — it would type `opts[o.key]` as
 *  `number | boolean` because of `speed` — so this narrows to the boolean
 *  keys. It admits `speedLocked` too, which is boolean but is not a setting
 *  this panel owns; OPTIONS is an explicit list, so it simply never appears. */
type ToggleKey = {
  [K in keyof EditingOptions]: EditingOptions[K] extends boolean ? K : never;
}[keyof EditingOptions];

const OPTIONS: Array<{
  key: ToggleKey;
  label: string;
  on: string;
  off: string;
  icon: string;
  /** Offered on a silent film? Default yes — set false for spoken-word only. */
  spokenOnly?: boolean;
}> = [
  {
    key: "captions",
    label: "Captions",
    on: "Subtitles appear on screen, paced to the narration",
    off: "No subtitles — visuals and voice only",
    icon: "💬",
    // A cinematic project's `Script Scenă` is an unspoken shot note, so there
    // is nothing to subtitle — `Build Remotion Props` forces showCaptions off
    // for it whatever this says. A toggle that cannot change the film is worse
    // than no toggle: it reads as a decision and silently isn't one.
    spokenOnly: true,
  },
  // The "Opening title" row is gone (2026-09-11): the title card was retired
  // with the teaser hook, and the cold open is reviewed in its own panel
  // beside this one (HookPanel) — a rewrite means new shots, not an overlay.
  {
    key: "chapterCards",
    label: "Chapter cards",
    on: "A full-screen card announces each chapter",
    off: "Straight cuts between chapters",
    icon: "📖",
  },
  {
    key: "endScreen",
    label: "End screen",
    on: "Channel outro plays after the last scene",
    off: "The video ends on the last scene",
    icon: "🎬",
  },
  {
    key: "sfx",
    label: "Sound effects",
    on: "Each scene's own ambience plays quietly under the narration — no voices or music from the clips, effects only",
    off: "The clips stay silent — narration only",
    icon: "🔊",
  },
  {
    key: "drawnCards",
    label: "Drawn cards",
    on: "Where the voice names something the camera cannot show, the film draws it",
    off: "No drawn cards — footage and text only",
    icon: "✏️",
  },
  {
    key: "sourceWatermark",
    label: "Source watermark",
    on: "Show a small label indicating whether each visual is AI-generated, authentic, archival, or illustrative.",
    off: "No origin label on screen — the provenance is still recorded, and a credit a licence requires is still shown",
    icon: "🔎",
  },
  // `watermarkOpenOnce` is NOT a row of its own. It was one, and as a second
  // numbered switch immediately under "Source watermark" it read as an equal
  // decision rather than as a detail of that one — and it is offered, at the
  // top level of the list, even on a film whose badge is switched off. It is
  // now a WatermarkOpenPicker nested under the row below, on the same rule as
  // the effects volume: a control for something that is off is a decision
  // with no subject. It is still saved from `opts`, which OPTIONS only
  // renders and never owns.
  {
    key: "music",
    label: "Music",
    on: "A background track plus whoosh/boom accents at the cuts — composed here, unrelated to what the scenes show",
    off: "No added music or accents",
    icon: "🎵",
  },
];

/**
 * What a drawn card will actually put on screen, in one line.
 *
 * The producer is deciding whether to keep a graphic they have never seen, so
 * the row has to say what it DRAWS, not what kind of object it is. "Route
 * chart" tells them nothing; "Digul → Ferry → Avion → Tahiti" is the decision.
 */
function describeMotif(card: MotifCard): { title: string; detail: string } {
  if (card.variant === "route") {
    return {
      title: "Map with the route",
      detail: [(card.stops ?? []).join(" → "), card.note].filter(Boolean).join("  ·  "),
    };
  }
  if (card.variant === "schedule") {
    return {
      title: "Departure board",
      detail: [
        (card.rows ?? []).map((r) => `${r.label} ${r.value}`).join("  ·  "),
        card.note,
      ]
        .filter(Boolean)
        .join("  —  "),
    };
  }
  if (card.variant === "timeline") {
    return {
      title: "Timeline of the dates",
      detail: [
        (card.marks ?? []).map((m) => `${m.at} ${m.label}`).join("  ·  "),
        card.note,
      ]
        .filter(Boolean)
        .join("  —  "),
    };
  }
  if (card.variant === "compare") {
    return {
      title: "Two figures compared",
      detail: [
        (card.sides ?? []).map((s) => `${s.label} ${s.value}`).join("  vs  "),
        card.note,
      ]
        .filter(Boolean)
        .join("  —  "),
    };
  }
  if (card.variant === "steps") {
    return {
      title: "The sequence, step by step",
      detail: [(card.steps ?? []).map((s) => s.label).join(" → "), card.note]
        .filter(Boolean)
        .join("  —  "),
    };
  }
  return {
    title: "Card",
    detail: card.note ?? card.label ?? card.variant,
  };
}

/** The slider's floor, in percent. Mirrors the brief's control: the switch
 *  above owns silence, so the level never reaches zero. */
const SFX_PCT_MIN = 10;
/** The music bed's floor, same reasoning; steps of 1 so the 22% default the
 *  mixer has always used sits on the scale. */
const MUSIC_PCT_MIN = 5;

export default function FinalSettings({
  projectId,
  initial,
  motifCards = [],
  silent = false,
  category = null,
  watermarkScenes = [],
  aspectRatio = null,
}: {
  projectId: string;
  initial: EditingOptions;
  /** Drawn cards the pipeline chose from the script; the producer may drop any. */
  motifCards?: MotifCard[];
  /** Cinematic: no narration is ever spoken, so some rows have no meaning. */
  silent?: boolean;
  /** The project's category. Source labels are a Documentary feature since
   *  2026-09-19 — see the note this renders when it is anything else. */
  category?: string | null;
  /**
   * The film's scenes, for the source-watermark preview. Empty on a film with
   * no archive step, which is exactly when the preview has nothing to show and
   * the button is not offered.
   */
  watermarkScenes?: PreviewScene[];
  /** The project's Format, so the preview frame has the film's shape. */
  aspectRatio?: string | null;
}) {
  const [opts, setOpts] = useState<EditingOptions>(initial);
  // Closed by default: this panel's job is one click, and a producer who wants
  // to see the badge is asking a question rather than passing through.
  const [showWatermark, setShowWatermark] = useState(false);
  // Kept by index. A dropped card is removed from the project on render, not
  // on the click — see the note on confirmFinalSettings.
  const [dropped, setDropped] = useState<number[]>([]);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Dropped rather than disabled, the same call the stepper makes about the
  // Audio step: a control you can reach and find inert is worse than one that
  // is simply not there.
  // Source labels are a Documentary feature (2026-09-19, the producer's call):
  // every other category is wall-to-wall AI, so the badge drew one continuous
  // AI GENERATED pill for the whole film and distinguished nothing.
  //
  // DROPPED rather than disabled, the same call as Captions on a silent film —
  // a control you can reach and find inert is worse than one that is not there.
  // But NOT silent: the note under the list says the labels are off and why,
  // because this gate is known to catch a documentary filed as Story and the
  // producer must be able to see that before the render rather than after it.
  const isDocumentary = String(category ?? "").trim() === "documentary";
  const rows = OPTIONS.filter(
    (o) => !(silent && o.spokenOnly) && !(!isDocumentary && o.key === "sourceWatermark"),
  );
  const changedKeys = rows.filter((o) => opts[o.key] !== initial[o.key]);
  // The effects volume is a row's SETTING, not a row of its own, so it has to
  // be counted by hand — otherwise moving only the slider left `changed`
  // false and "Keep initial settings" would have quietly discarded it.
  // Same shape as the effects volume: a row's setting, invisible to
  // changedKeys, so it is counted by hand or "Keep initial settings" would
  // discard a colour the producer had just chosen.
  const captionColorMoved =
    rows.some((o) => o.key === "captions") &&
    (opts.captionColor ?? null) !== (initial.captionColor ?? null);
  const sfxLevelMoved =
    rows.some((o) => o.key === "sfx") && opts.sfxLevel !== initial.sfxLevel;
  const musicLevelMoved =
    rows.some((o) => o.key === "music") && opts.musicLevel !== initial.musicLevel;
  // And the same again for how often the badge opens, which stopped being a
  // row of its own on 2026-09-19 and became a setting of the watermark row.
  // That move is exactly what puts it in this list: `changedKeys` only sees
  // OPTIONS rows, so without this, picking "Once per source" and nothing else
  // would leave the button reading "Keep initial settings" and throw the
  // choice away — the failure the two above are here to prevent.
  const watermarkOpenMoved =
    rows.some((o) => o.key === "sourceWatermark") &&
    (opts.watermarkOpenOnce === true) !== (initial.watermarkOpenOnce === true);
  const watermarkScaleMoved =
    rows.some((o) => o.key === "sourceWatermark") &&
    opts.watermarkScale !== initial.watermarkScale;
  // Not a row either, so counted by hand like the three above: picking a
  // style and nothing else must still render with it.
  const motionPackMoved = (opts.motionPack ?? null) !== (initial.motionPack ?? null);
  const graphicStyleMoved = (opts.graphicStyle ?? null) !== (initial.graphicStyle ?? null);
  const showGraphics = offersGraphicStyle(category);
  const plan = initial.graphicPlan;
  const [planMsg, setPlanMsg] = useState<ActionResult | null>(null);
  const [planPending, startPlan] = useTransition();
  // The pace is NOT here any more — it is decided and signed off at the audio
  // step, the one moment it costs nothing, and this panel neither shows it nor
  // writes it. (confirmFinalSettings therefore omits `speed` entirely rather
  // than sending a default, which would overwrite that choice on every
  // render.)
  //
  // A dropped animation still counts alongside the toggles: it changes the
  // film, and a button reading "Keep initial settings" after you switched one
  // off would be telling you something untrue.
  const changed =
    changedKeys.length > 0 ||
    dropped.length > 0 ||
    sfxLevelMoved ||
    musicLevelMoved ||
    captionColorMoved ||
    watermarkOpenMoved ||
    watermarkScaleMoved ||
    motionPackMoved ||
    graphicStyleMoved;
  const changeCount =
    changedKeys.length +
    dropped.length +
    (sfxLevelMoved ? 1 : 0) +
    (musicLevelMoved ? 1 : 0) +
    (captionColorMoved ? 1 : 0) +
    (watermarkOpenMoved ? 1 : 0) +
    (watermarkScaleMoved ? 1 : 0) +
    (motionPackMoved ? 1 : 0) +
    (graphicStyleMoved ? 1 : 0);
  const done = msg?.ok === true;
  const router = useRouter();
  const setPendingStage = useSetPendingStage();

  /**
   * Confirming is the last decision on this screen — the project leaves this
   * gate the moment it succeeds. Staying put showed a panel that no longer
   * had a job while the render it had just started was invisible one step
   * away, so it carries the producer to Assembly itself.
   */
  const confirm = () =>
    startTransition(async () => {
      const kept = motifCards.filter((_, i) => !dropped.includes(i));
      const r = await confirmFinalSettings(
        projectId,
        changed ? opts : undefined,
        dropped.length ? kept : undefined,
      );
      setMsg(r);
      if (r.ok) {
        setPendingStage("assembly");
        router.push(`/projects/${projectId}?stage=assembly`, { scroll: false });
      }
    });

  return (
    <div
      className="script"
      style={{
        marginTop: 24,
        border: "1px solid rgba(122, 79, 214,0.35)",
        boxShadow: "0 0 0 1px rgba(122, 79, 214,0.06), 0 18px 50px rgba(0,0,0,0.35)",
      }}
    >
      <div className="sechead">
        <h2>Final touches</h2>
        <span className="chip wait">Waiting on you</span>
      </div>

      <p style={{ margin: "0 0 4px", fontSize: 14.5, color: "var(--ink)" }}>
        Every scene is approved. One last look at what gets drawn over the
        video, then it goes to render.
      </p>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--soft)" }}>
        Nothing to change? Just press <b>Keep initial settings</b> — these are
        already the choices you made when you started the project.
      </p>

      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}

      {/* Said out loud rather than left to be discovered in the finished film.
          The Source watermark row is dropped on anything but a Documentary
          (2026-09-19), and the gate is KNOWN to catch a documentary that was
          filed as Story — which is most of them, because Story is the default
          category. A producer who meant to label this film can only find that
          out here, and only if somebody says it. */}
      {!isDocumentary && (
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 12.5,
            color: "var(--soft)",
            borderLeft: "2px solid var(--line)",
            paddingLeft: 10,
          }}
        >
          <b>No source labels on this film.</b> Saying on screen whether a shot is
          AI-generated, archival or real is a Documentary feature — this project is
          filed as{" "}
          <b>{String(category ?? "story").replace(/_/g, " ")}</b>. A licence credit,
          where one is owed, is still drawn.
        </p>
      )}

      {/* The last five decisions as a numbered index — hairlines and a drawn
          switch, not a grid of boxed checkboxes. A changed row says so in
          amber right next to its name. */}
      <div
        className="swlist"
        style={{
          opacity: done ? 0.5 : 1,
          pointerEvents: done ? "none" : undefined,
        }}
      >
        {rows.map((o, i) => {
          const on = opts[o.key];
          const moved = on !== initial[o.key];
          return (
            <div key={o.key} className={`swrow ${on ? "on" : ""}`}>
              <span className="no">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h4>
                  {o.label}
                  {(moved ||
                    (o.key === "sfx" && sfxLevelMoved) ||
                    (o.key === "music" && musicLevelMoved) ||
                    (o.key === "captions" && captionColorMoved) ||
                    (o.key === "sourceWatermark" &&
                      (watermarkOpenMoved || watermarkScaleMoved))) && (
                    <span className="chg">changed</span>
                  )}
                </h4>
                <p>{on ? o.on : o.off}</p>
                {o.key === "captions" && on && (
                  <CaptionColorPicker
                    value={opts.captionColor ?? ""}
                    onChange={(v) =>
                      setOpts((p) => ({ ...p, captionColor: v || null }))
                    }
                  />
                )}
                {/* Deliberately NOT gated on `on`. The sentence this row has
                    to get across is that switching the label off leaves a
                    credit a licence demands standing, and the only way to make
                    that believable is to let the producer watch it happen. */}
                {/* How often the badge opens — gated on `on`, unlike the
                    preview below it, because there is nothing to open when
                    the label is off. `changed` is reported by the row above,
                    since the producer moved it inside that row. */}
                {o.key === "sourceWatermark" && on && (
                  <div style={{ marginTop: 10 }}>
                    <WatermarkOpenPicker
                      value={opts.watermarkOpenOnce === true}
                      onChange={(v) =>
                        setOpts((p) => ({ ...p, watermarkOpenOnce: v }))
                      }
                    />
                    <div style={{ marginTop: 14 }}>
                      <WatermarkSizePicker
                        value={opts.watermarkScale}
                        onChange={(v) =>
                          setOpts((p) => ({ ...p, watermarkScale: v }))
                        }
                        portrait={String(aspectRatio ?? "").trim() === "9:16"}
                      />
                    </div>
                  </div>
                )}
                {o.key === "sourceWatermark" && watermarkScenes.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="abtn"
                      aria-expanded={showWatermark}
                      onClick={() => setShowWatermark((v) => !v)}
                    >
                      {showWatermark ? "Hide preview" : "👁 Preview on this film"}
                    </button>
                    {showWatermark && (
                      <WatermarkPreview
                        scenes={watermarkScenes}
                        aspectRatio={aspectRatio}
                        showLabel={on}
                        // Read from the live draft, not from `initial`: the
                        // two switches sit in the same list and the preview
                        // has to answer for the pair the producer is looking
                        // at right now.
                        openOncePerOrigin={opts.watermarkOpenOnce === true}
                        scale={opts.watermarkScale}
                      />
                    )}
                  </div>
                )}
                {/* Same rule as the brief: the level is only shown while the
                    effects are on, and only the switch can silence them. */}
                {o.key === "sfx" && on && (
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
                      <label htmlFor="fs_sfx_level">Effects volume</label>
                      <b
                        style={{
                          color: "var(--ink)",
                          fontFamily: "var(--f-mono), ui-monospace, monospace",
                        }}
                      >
                        {Math.round(opts.sfxLevel * 100)}%
                      </b>
                    </div>
                    <input
                      id="fs_sfx_level"
                      type="range"
                      className="lenslider"
                      min={SFX_PCT_MIN}
                      max={100}
                      step={5}
                      value={Math.round(opts.sfxLevel * 100)}
                      onChange={(e) =>
                        setOpts((p) => ({
                          ...p,
                          sfxLevel: Number(e.target.value) / 100,
                        }))
                      }
                      style={{
                        margin: "8px 0 2px",
                        ["--fill" as string]: `${((Math.round(opts.sfxLevel * 100) - SFX_PCT_MIN) / (100 - SFX_PCT_MIN)) * 100}%`,
                      }}
                      aria-label="Effects volume"
                    />
                  </div>
                )}
                {/* The background track's level, only while music is on. The
                    accents at the cuts keep their own fixed levels — this is
                    the bed under the voice, nothing else. */}
                {o.key === "music" && on && (
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
                      <label htmlFor="fs_music_level">Music volume</label>
                      <b
                        style={{
                          color: "var(--ink)",
                          fontFamily: "var(--f-mono), ui-monospace, monospace",
                        }}
                      >
                        {Math.round(opts.musicLevel * 100)}%
                      </b>
                    </div>
                    <input
                      id="fs_music_level"
                      type="range"
                      className="lenslider"
                      min={MUSIC_PCT_MIN}
                      max={100}
                      step={1}
                      value={Math.round(opts.musicLevel * 100)}
                      onChange={(e) =>
                        setOpts((p) => ({
                          ...p,
                          musicLevel: Number(e.target.value) / 100,
                        }))
                      }
                      style={{
                        margin: "8px 0 2px",
                        ["--fill" as string]: `${((Math.round(opts.musicLevel * 100) - MUSIC_PCT_MIN) / (100 - MUSIC_PCT_MIN)) * 100}%`,
                      }}
                      aria-label="Music volume"
                    />
                  </div>
                )}
              </div>
              <Toggle
                checked={on}
                ariaLabel={o.label}
                onChange={(v) => setOpts((p) => ({ ...p, [o.key]: v }))}
              />
            </div>
          );
        })}
      </div>

      {/* How the graphics move (lib/motion-packs.ts). Not a toggle row: one
          choice among five, where "Auto" stores nothing and lets the
          category's default decide at render time. */}
      <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
        <h4 style={{ margin: 0 }}>
          Animation style
          {motionPackMoved && <span className="chg">changed</span>}
        </h4>
        <div className="seg" role="group" aria-label="Animation style" style={{ flexWrap: "wrap", marginTop: 10 }}>
          <button
            type="button"
            className={!opts.motionPack ? "on" : ""}
            onClick={() => setOpts((p) => ({ ...p, motionPack: null }))}
          >
            Auto · {MOTION_PACKS.find((m) => m.id === defaultMotionPackFor(category))?.label}
          </button>
          {MOTION_PACKS.map((m) => (
            <button
              type="button"
              key={m.id}
              className={opts.motionPack === m.id ? "on" : ""}
              onClick={() => setOpts((p) => ({ ...p, motionPack: m.id }))}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="fnote" style={{ marginTop: 8 }}>
          {opts.motionPack
            ? MOTION_PACKS.find((m) => m.id === opts.motionPack)?.hint
            : "How captions and chapter titles move. Auto follows the film's category."}
        </p>
      </div>

      {/* Which graphics ride over the footage (lib/graphic-styles.ts), and
          what they say. "AI picks" stores nothing and uses the style the
          graphic-plan workflow chose by theme; the list under it is what that
          workflow found in the scenes, shown so a wrong name is caught here
          rather than in the finished film. */}
      {showGraphics && (
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
          <h4 style={{ margin: 0 }}>
            Graphics
            {graphicStyleMoved && <span className="chg">changed</span>}
          </h4>
          <div className="seg" role="group" aria-label="Graphics" style={{ flexWrap: "wrap", marginTop: 10 }}>
            <button
              type="button"
              className={!opts.graphicStyle ? "on" : ""}
              onClick={() => setOpts((p) => ({ ...p, graphicStyle: null }))}
            >
              ✨ AI picks{plan?.source === "ai" ? ` · ${graphicStyleLabel(plan.style)}` : ""}
            </button>
            {GRAPHIC_STYLES.map((g) => (
              <button
                type="button"
                key={g.id}
                className={opts.graphicStyle === g.id ? "on" : ""}
                onClick={() => setOpts((p) => ({ ...p, graphicStyle: g.id }))}
              >
                {g.label}
              </button>
            ))}
          </div>
          <p className="fnote" style={{ marginTop: 8 }}>
            {opts.graphicStyle
              ? GRAPHIC_STYLES.find((g) => g.id === opts.graphicStyle)?.hint
              : plan?.source === "ai"
                ? `Chosen for this film's theme${plan.why ? `: ${plan.why}` : "."}`
                : "The AI has not chosen yet — without a choice the film has no graphics. Press Choose again."}
          </p>
          {opts.graphicStyle !== "classic" && (
            <div style={{ marginTop: 10 }}>
              {plan && plan.items.length > 0 ? (
                <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55 }}>
                  {plan.items.map((it, i) => (
                    <li key={i}>
                      <span style={{ color: "var(--soft)" }}>
                        Scene {it.sceneOrder} · {it.kind === "person" ? "Name" : it.kind === "place" ? "Place" : "Figure"} —{" "}
                      </span>
                      {it.kind === "stat" ? (
                        <b>
                          {it.value}
                          {it.suffix ?? ""} {it.label}
                        </b>
                      ) : (
                        <b>{it.title}</b>
                      )}
                      {it.kind !== "stat" && it.subtitle ? <span style={{ color: "var(--soft)" }}> · {it.subtitle}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="fnote" style={{ margin: "0 0 8px" }}>
                  {plan ? "No names, places or figures were worth a graphic — only chapter titles will be drawn." : "No graphics chosen yet."}
                </p>
              )}
              {planMsg && <p className={`formmsg ${planMsg.ok ? "ok" : "err"}`}>{planMsg.message}</p>}
              <button
                type="button"
                className="btn ghost"
                disabled={planPending}
                onClick={() => startPlan(async () => setPlanMsg(await requestGraphicPlan(projectId)))}
              >
                ⟳ Choose again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Drawn cards. Absent entirely when the pipeline chose none, which is
          the common case and the correct one — most scenes deserve no graphic,
          and an empty "no animations" panel would only invite adding some. */}
      {/* The chosen cards, listed under the switch that permits them. Hidden
          rather than greyed when the switch is off: this is a finishing
          screen, and a list of things that will not be drawn is not a
          decision the producer still has to read. Switching back on brings
          it back exactly as it was — nothing here is destroyed by the
          switch, only by dropping a card. */}
      {opts.drawnCards && motifCards.length > 0 && (
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
          <h3
            style={{
              margin: "0 0 4px",
              fontSize: 13,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: "var(--soft)",
            }}
          >
            Animations in this film
          </h3>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
            Chosen from your script: each one replaces the picture for about
            three seconds with a drawing of something the voice says but the
            camera cannot show. Every word on them is checked against the
            script itself. Switch one off and it will not be drawn.
          </p>

          <div
            className="swlist"
            style={{ opacity: done ? 0.5 : 1, pointerEvents: done ? "none" : undefined }}
          >
            {motifCards.map((card, i) => {
              const { title, detail } = describeMotif(card);
              const keep = !dropped.includes(i);
              return (
                <div key={`${card.variant}-${card.sceneIndex}-${i}`} className={`swrow ${keep ? "on" : ""}`}>
                  <span className="no">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h4>
                      {title}
                      <span style={{ color: "var(--dim)", fontWeight: 400 }}>
                        {" "}· scene {card.sceneIndex + 1}
                      </span>
                      {/* The pipeline could prove this card is truthful but not
                          that its phrasing follows from what it quoted. That is
                          precisely the one worth a human glance. */}
                      {card.verdict === "review" && <span className="chg">worth a look</span>}
                    </h4>
                    <p>{keep ? detail : "Will not be drawn"}</p>
                  </div>
                  <Toggle
                    checked={keep}
                    ariaLabel={`${title} on scene ${card.sceneIndex + 1}`}
                    onChange={(v) =>
                      setDropped((p) => (v ? p.filter((x) => x !== i) : [...p, i]))
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid var(--line)",
        }}
      >
        <button
          className="btn gold"
          disabled={pending || done}
          onClick={confirm}
          style={{ fontSize: 14, padding: "11px 20px" }}
        >
          {done
            ? "Rendering…"
            : pending
              ? "…"
              : changed
                ? `Apply ${changeCount} change${changeCount === 1 ? "" : "s"} & render`
                : "Keep initial settings & render"}
        </button>
        {changed && !done && (
          <button
            className="btn"
            disabled={pending}
            onClick={() => {
              setOpts(initial);
              setDropped([]);
            }}
          >
            Undo changes
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--dim)" }}>
          Rendering takes a few minutes — the final video appears at the top of
          this page on its own.
        </span>
      </div>
    </div>
  );
}
