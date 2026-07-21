"use client";

import { useState, useTransition } from "react";
import {
  approveAllScenes,
  saveSceneScript,
  type ActionResult,
} from "@/app/actions";
import type { Scene } from "@/lib/data";

/**
 * Scene review stage — mirrors the script review: after the main script is
 * approved, each scene's narration and image prompt are editable here, and
 * approving flips "Aprobare Scenă" in Airtable. The scripting workflow polls
 * every 15s and moves to image generation once every scene is approved.
 */
export default function SceneReview({
  projectId,
  scenes,
}: {
  projectId: string;
  scenes: Scene[];
}) {
  const [drafts, setDrafts] = useState<
    Record<string, { narration: string; imagePrompt: string }>
  >({});
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const draftFor = (s: Scene) =>
    drafts[s.id] ?? {
      narration: s.narration ?? "",
      imagePrompt: s.imagePrompt ?? "",
    };
  const isDirty = (s: Scene) => {
    const d = drafts[s.id];
    return (
      !!d &&
      (d.narration !== (s.narration ?? "") ||
        d.imagePrompt !== (s.imagePrompt ?? ""))
    );
  };
  const setDraft = (s: Scene, patch: Partial<{ narration: string; imagePrompt: string }>) =>
    setDrafts((prev) => ({ ...prev, [s.id]: { ...draftFor(s), ...patch } }));

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setMsg(await fn()));

  const unapproved = scenes.filter((s) => !s.sceneApproved);
  const approvedCount = scenes.length - unapproved.length;

  const taStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--bg2)",
    border: "1px solid var(--line2)",
    borderRadius: 10,
    color: "var(--ink)",
    font: "inherit",
    fontSize: 13.5,
    lineHeight: 1.6,
    padding: "10px 12px",
    resize: "vertical",
    outline: "none",
  };

  return (
    <div className="script">
      <div className="sechead">
        <h2>Scene review</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--soft)" }}>
            {approvedCount}/{scenes.length} approved
          </span>
          {unapproved.length > 0 && (
            <button
              className="btn gold"
              disabled={pending}
              onClick={() =>
                run(() =>
                  approveAllScenes(
                    projectId,
                    unapproved.map((s) => s.id),
                  ),
                )
              }
            >
              {pending ? "…" : `Approve all ${unapproved.length} scenes`}
            </button>
          )}
        </div>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
        Edit each scene&apos;s narration and image prompt, then approve. Image
        generation starts once every scene is approved — the pipeline checks
        again within ~15s.
      </p>
      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {scenes.map((s, i) => {
          const d = draftFor(s);
          return (
            <div className="card" key={s.id}>
              <div className="kv" style={{ borderBottom: "none", paddingBottom: 6 }}>
                <h5 style={{ margin: 0 }}>
                  S{i + 1} · Scene
                </h5>
                {s.sceneApproved ? (
                  <span className="chip ok">Approved</span>
                ) : (
                  <span className="chip wait">Awaiting review</span>
                )}
              </div>

              <label
                style={{ display: "block", fontSize: 12, color: "var(--dim)", margin: "8px 0 4px" }}
              >
                Narration (spoken by the voice-over)
              </label>
              <textarea
                value={d.narration}
                onChange={(e) => setDraft(s, { narration: e.target.value })}
                rows={3}
                spellCheck={false}
                disabled={s.sceneApproved}
                style={{ ...taStyle, opacity: s.sceneApproved ? 0.6 : 1 }}
              />

              <label
                style={{ display: "block", fontSize: 12, color: "var(--dim)", margin: "10px 0 4px" }}
              >
                Image prompt (what the scene looks like)
              </label>
              <textarea
                value={d.imagePrompt}
                onChange={(e) => setDraft(s, { imagePrompt: e.target.value })}
                rows={3}
                spellCheck={false}
                disabled={s.sceneApproved}
                style={{ ...taStyle, opacity: s.sceneApproved ? 0.6 : 1 }}
              />

              {!s.sceneApproved && (
                <div className="abtns">
                  <button
                    className="abtn ok"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        saveSceneScript(projectId, s.id, d.narration, d.imagePrompt, true),
                      )
                    }
                  >
                    Approve scene
                  </button>
                  <button
                    className="abtn"
                    disabled={pending || !isDirty(s)}
                    onClick={() =>
                      run(() =>
                        saveSceneScript(projectId, s.id, d.narration, d.imagePrompt, false),
                      )
                    }
                  >
                    Save draft
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
