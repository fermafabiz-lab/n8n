"use client";

import { useState, useTransition } from "react";
import { confirmFinalSettings, type ActionResult } from "@/app/actions";
import type { EditingOptions } from "@/lib/data";

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
const OPTIONS: Array<{
  key: keyof EditingOptions;
  label: string;
  on: string;
  off: string;
  icon: string;
}> = [
  {
    key: "captions",
    label: "Captions",
    on: "Subtitles appear on screen, paced to the narration",
    off: "No subtitles — visuals and voice only",
    icon: "💬",
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
];

export default function FinalSettings({
  projectId,
  initial,
}: {
  projectId: string;
  initial: EditingOptions;
}) {
  const [opts, setOpts] = useState<EditingOptions>(initial);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const changedKeys = OPTIONS.filter((o) => opts[o.key] !== initial[o.key]);
  const changed = changedKeys.length > 0;
  const done = msg?.ok === true;

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setMsg(await fn()));

  return (
    <div
      className="script"
      style={{
        marginTop: 24,
        border: "1px solid rgba(245,184,65,0.35)",
        boxShadow: "0 0 0 1px rgba(245,184,65,0.06), 0 18px 50px rgba(0,0,0,0.35)",
      }}
    >
      <div className="sechead">
        <h2>
          <span style={{ marginRight: 8 }}>🎞</span>Final touches
        </h2>
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 10,
          opacity: done ? 0.5 : 1,
          pointerEvents: done ? "none" : undefined,
        }}
      >
        {OPTIONS.map((o) => {
          const on = opts[o.key];
          const moved = on !== initial[o.key];
          return (
            <label
              key={o.key}
              className="card"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 15px",
                cursor: "pointer",
                borderColor: moved ? "rgba(245,184,65,0.5)" : undefined,
                background: on ? undefined : "var(--bg2)",
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1.2 }}>{o.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13.5,
                    fontWeight: 600,
                    marginBottom: 3,
                  }}
                >
                  {o.label}
                  {moved && <span className="chip wait">changed</span>}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: on ? "var(--soft)" : "var(--dim)",
                    lineHeight: 1.5,
                  }}
                >
                  {on ? o.on : o.off}
                </span>
              </span>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => setOpts((p) => ({ ...p, [o.key]: e.target.checked }))}
                style={{
                  width: 18,
                  height: 18,
                  marginTop: 2,
                  flex: "none",
                  accentColor: "var(--amber)",
                  cursor: "pointer",
                }}
              />
            </label>
          );
        })}
      </div>

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
          onClick={() =>
            run(() => confirmFinalSettings(projectId, changed ? opts : undefined))
          }
          style={{ fontSize: 14, padding: "11px 20px" }}
        >
          {done
            ? "Rendering…"
            : pending
              ? "…"
              : changed
                ? `Apply ${changedKeys.length} change${changedKeys.length === 1 ? "" : "s"} & render`
                : "Keep initial settings & render"}
        </button>
        {changed && !done && (
          <button className="btn" disabled={pending} onClick={() => setOpts(initial)}>
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
