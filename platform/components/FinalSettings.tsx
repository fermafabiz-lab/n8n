"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmFinalSettings, type ActionResult } from "@/app/actions";
import Toggle from "@/components/Toggle";
import SpeedPicker from "@/components/SpeedPicker";
import { useSetPendingStage } from "@/components/StageNav";
import type { EditingOptions, MotifCard } from "@/lib/data";

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
/** Only the switch-shaped options belong in the list below — `speed` is a
 *  number and gets its own row, so `keyof EditingOptions` is too wide and
 *  would type `opts[o.key]` as `number | boolean`. */
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
  {
    key: "hookTitle",
    label: "Opening title",
    on: "The hook line types itself over the first scene",
    off: "Clean opening, straight into the story",
    icon: "✨",
  },
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
  return {
    title: "Card",
    detail: card.note ?? card.label ?? card.variant,
  };
}

export default function FinalSettings({
  projectId,
  initial,
  motifCards = [],
  silent = false,
}: {
  projectId: string;
  initial: EditingOptions;
  /** Drawn cards the pipeline chose from the script; the producer may drop any. */
  motifCards?: MotifCard[];
  /** Cinematic: no narration is ever spoken, so some rows have no meaning. */
  silent?: boolean;
}) {
  const [opts, setOpts] = useState<EditingOptions>(initial);
  // Kept by index. A dropped card is removed from the project on render, not
  // on the click — see the note on confirmFinalSettings.
  const [dropped, setDropped] = useState<number[]>([]);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Dropped rather than disabled, the same call the stepper makes about the
  // Audio step: a control you can reach and find inert is worse than one that
  // is simply not there.
  const rows = OPTIONS.filter((o) => !(silent && o.spokenOnly));
  const changedKeys = rows.filter((o) => opts[o.key] !== initial[o.key]);
  // Speed is a number, so it cannot join OPTIONS (booleans with a Toggle) and
  // is counted separately — but it must be counted, or "Apply 1 change" would
  // omit the one change that alters the film's whole length.
  const speedMoved = opts.speed !== initial.speed;
  // A dropped animation counts for the same reason speed does: it changes the
  // film, and a button reading "Keep initial settings" after you switched one
  // off would be telling you something untrue.
  const changed = changedKeys.length > 0 || speedMoved || dropped.length > 0;
  const changeCount = changedKeys.length + (speedMoved ? 1 : 0) + dropped.length;
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
                  {moved && <span className="chg">changed</span>}
                </h4>
                <p>{on ? o.on : o.off}</p>
              </div>
              <Toggle
                checked={on}
                ariaLabel={o.label}
                onChange={(v) => setOpts((p) => ({ ...p, [o.key]: v }))}
              />
            </div>
          );
        })}
        {/* Not a switch, so it sits at the end of the same numbered index
            rather than pretending to be one. It is offered on a silent film
            too: a cinematic project has no narration to slow down, but the
            picture, the music and the graphics all still re-time. */}
        <div className={`swrow ${opts.speed !== 1 ? "on" : ""}`}>
          <span className="no">{String(rows.length + 1).padStart(2, "0")}</span>
          <div>
            <h4>
              Speed
              {speedMoved && <span className="chg">changed</span>}
            </h4>
            <p>
              How fast the finished film plays. This is what the PACE choice on
              the brief sets — before now it only nudged the writing prompts and
              left the video untouched.
            </p>
          </div>
          <SpeedPicker
            value={opts.speed}
            onChange={(v) => setOpts((p) => ({ ...p, speed: v }))}
            disabled={done}
          />
        </div>
      </div>

      {/* Drawn cards. Absent entirely when the pipeline chose none, which is
          the common case and the correct one — most scenes deserve no graphic,
          and an empty "no animations" panel would only invite adding some. */}
      {motifCards.length > 0 && (
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
