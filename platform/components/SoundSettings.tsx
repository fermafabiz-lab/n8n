"use client";

import { useState, useTransition } from "react";
import { rerenderWithSound, type ActionResult } from "@/app/actions";
import Toggle from "@/components/Toggle";
import SpeedPicker from "@/components/SpeedPicker";

/**
 * The two audio switches AND the playback speed, usable AFTER the render —
 * the gap that made them look broken: Final touches disappears once the
 * project renders, and the Restart button reuses whatever was stored, so a
 * producer who wanted to add or drop music on a finished film had no path to
 * it at all.
 *
 * Speed belongs here for the same reason and by the same mechanism: it is an
 * output setting, judged by watching the film, and changing it re-renders
 * without regenerating a single scene.
 *
 * Saves the merged Editing Options first, then fires the assemble webhook —
 * the same proven pair Final touches uses.
 */
export default function SoundSettings({
  projectId,
  initialSfx,
  initialMusic,
  initialSpeed,
}: {
  projectId: string;
  initialSfx: boolean;
  initialMusic: boolean;
  initialSpeed: number;
}) {
  const [sfx, setSfx] = useState(initialSfx);
  const [music, setMusic] = useState(initialMusic);
  const [speed, setSpeed] = useState(initialSpeed);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const changed =
    sfx !== initialSfx || music !== initialMusic || speed !== initialSpeed;
  const started = msg?.ok === true;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h5>Sound and speed of this film</h5>
      <div className="kv">
        <span>
          Sound effects
          <span style={{ display: "block", fontSize: 11.5, color: "var(--dim)" }}>
            each scene&apos;s own ambience, ducked under the narration
          </span>
        </span>
        <Toggle checked={sfx} ariaLabel="Sound effects" onChange={setSfx} />
      </div>
      <div className="kv">
        <span>
          Music
          <span style={{ display: "block", fontSize: 11.5, color: "var(--dim)" }}>
            background track + whoosh/boom accents at the cuts
          </span>
        </span>
        <Toggle checked={music} ariaLabel="Music" onChange={setMusic} />
      </div>
      <div className="kv" style={{ alignItems: "flex-start" }}>
        <span>
          Speed
          <span style={{ display: "block", fontSize: 11.5, color: "var(--dim)" }}>
            what the PACE choice on the brief sets
          </span>
        </span>
        <SpeedPicker value={speed} onChange={setSpeed} disabled={pending} />
      </div>
      {msg && (
        <p className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 8 }}>
          {msg.message}
        </p>
      )}
      {changed && !started && (
        <button
          className="abtn ok"
          style={{ width: "100%", marginTop: 10 }}
          disabled={pending}
          onClick={() =>
            startTransition(async () =>
              setMsg(await rerenderWithSound(projectId, sfx, music, speed)),
            )
          }
        >
          {pending ? "…" : "Re-render with these settings"}
        </button>
      )}
      {!changed && !started && (
        <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
          Change any of these to re-render this film — scenes are not
          regenerated, only the final mix and its timing.
        </p>
      )}
    </div>
  );
}
