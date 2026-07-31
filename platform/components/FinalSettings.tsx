"use client";

import { useState, useTransition } from "react";
import { confirmFinalSettings, type ActionResult } from "@/app/actions";
import type { EditingOptions } from "@/lib/data";

/**
 * The last gate: every clip is approved and the batch is holding just before
 * final assembly. The overlay choices made when the project was created are
 * still changeable here — the graphics pass reads them from the project
 * record at render time — and confirming is what releases the batch.
 */
const OPTIONS: Array<{ key: keyof EditingOptions; label: string; hint: string }> = [
  { key: "captions", label: "Captions", hint: "On-screen subtitles, paced to the narration" },
  { key: "hookTitle", label: "Opening title", hint: "Typed-on hook text over the first scene" },
  { key: "chapterCards", label: "Chapter cards", hint: "Full-screen card at every chapter break" },
  { key: "endScreen", label: "End screen", hint: "Channel outro after the last scene" },
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
  const changed = OPTIONS.some((o) => opts[o.key] !== initial[o.key]);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setMsg(await fn()));

  return (
    <div className="script" style={{ marginTop: 24 }}>
      <div className="sechead">
        <h2>Final touches</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn"
            disabled={pending}
            onClick={() => run(() => confirmFinalSettings(projectId))}
          >
            Keep initial settings
          </button>
          <button
            className="btn gold"
            disabled={pending || !changed}
            onClick={() => run(() => confirmFinalSettings(projectId, opts))}
          >
            {pending ? "…" : "Apply & assemble"}
          </button>
        </div>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
        Every clip is approved. These overlays are added while the final video
        is rendered, so this is the last moment to change them — after
        assembly starts, changing one means rendering again.
      </p>
      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {OPTIONS.map((o) => {
          const on = opts[o.key];
          return (
            <label
              key={o.key}
              className="card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => setOpts((p) => ({ ...p, [o.key]: e.target.checked }))}
                style={{ width: 17, height: 17, accentColor: "var(--amber)" }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {o.label}
                  {on !== initial[o.key] && (
                    <span className="chip wait" style={{ marginLeft: 10 }}>
                      changed
                    </span>
                  )}
                </span>
                <span style={{ display: "block", fontSize: 12, color: "var(--soft)" }}>
                  {o.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
