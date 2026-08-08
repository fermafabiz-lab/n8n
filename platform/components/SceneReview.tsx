"use client";

import { useState, useTransition } from "react";
import {
  approveAllScenes,
  cancelSceneRewrite,
  regenerateSceneText,
  restartSceneRewrite,
  saveSceneScript,
  type ActionResult,
} from "@/app/actions";
import type { Scene } from "@/lib/data";
import RegenBadge from "@/components/RegenBadge";

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
  // Drafts survive remounts via sessionStorage — the page auto-refreshes
  // every 10s and a component remount used to silently discard in-progress
  // edits back to the server's version (same failure as ScriptReview).
  const draftKey = `vf-scene-drafts:${projectId}`;
  const [drafts, setDrafts] = useState<
    Record<string, { narration: string; imagePrompt: string }>
  >(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) ?? "{}");
    } catch {
      return {};
    }
  });
  const persistDrafts = (next: Record<string, { narration: string; imagePrompt: string }>) => {
    setDrafts(next);
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(next));
    } catch {}
  };
  const dropDraft = (sceneId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[sceneId];
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
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
    persistDrafts({ ...drafts, [s.id]: { ...draftFor(s), ...patch } });

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
                run(async () => {
                  // Scenes with unsaved edits must be approved WITH their
                  // edits — the bulk action alone only flips the checkbox,
                  // and silently discarding drafts is how an edited image
                  // prompt once never reached production.
                  const dirtyScenes = unapproved.filter((s) => isDirty(s));
                  for (const s of dirtyScenes) {
                    const d = draftFor(s);
                    const r = await saveSceneScript(projectId, s.id, d.narration, d.imagePrompt, true);
                    if (!r.ok) return r;
                    dropDraft(s.id);
                  }
                  const rest = unapproved.filter((s) => !isDirty(s)).map((s) => s.id);
                  if (rest.length === 0) {
                    return {
                      ok: true,
                      message: `Approved ${dirtyScenes.length} scenes (with your edits) — production continues.`,
                    };
                  }
                  const r = await approveAllScenes(projectId, rest);
                  return r.ok && dirtyScenes.length > 0
                    ? { ...r, message: `${r.message} Your edits on ${dirtyScenes.length} scene(s) were saved too.` }
                    : r;
                })
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
                ) : s.rewriteRequested ? (
                  <span className="chip run">Rewriting…</span>
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

              {!s.sceneApproved && s.rewriteRequested && (
                <>
                  <RegenBadge label="Rewriting scene…" note={s.note} />
                  {/*
                    This state is cleared from inside the n8n run, so a run
                    that dies never clears it — and it replaces the whole
                    button row, so the scene became unreachable: not
                    approvable, not editable, not even retryable. These two
                    are the way out, and they are deliberately quiet: a
                    rewrite normally lands in ~30s, so anyone still looking
                    at them has a run that is not coming back.
                  */}
                  <div className="abtns" style={{ marginTop: 10 }}>
                    <button
                      className="abtn"
                      disabled={pending}
                      onClick={() => run(() => restartSceneRewrite(projectId, s.id))}
                    >
                      ⟳ Send the rewrite again
                    </button>
                    <button
                      className="abtn"
                      disabled={pending}
                      onClick={() => run(() => cancelSceneRewrite(projectId, s.id))}
                    >
                      Cancel — keep this text
                    </button>
                  </div>
                </>
              )}
              {!s.sceneApproved && !s.rewriteRequested && (
                <div className="abtns">
                  <button
                    className="abtn ok"
                    disabled={pending || s.rewriteRequested}
                    onClick={() =>
                      run(async () => {
                        const r = await saveSceneScript(projectId, s.id, d.narration, d.imagePrompt, true);
                        if (r.ok) dropDraft(s.id);
                        return r;
                      })
                    }
                  >
                    Approve scene
                  </button>
                  <button
                    className="abtn"
                    disabled={pending || !isDirty(s)}
                    onClick={() =>
                      run(async () => {
                        const r = await saveSceneScript(projectId, s.id, d.narration, d.imagePrompt, false);
                        if (r.ok) dropDraft(s.id);
                        return r;
                      })
                    }
                  >
                    Save draft
                  </button>
                  <button
                    className="abtn"
                    disabled={pending || s.rewriteRequested}
                    onClick={() => run(() => regenerateSceneText(projectId, s.id))}
                  >
                    {s.rewriteRequested ? "Rewriting…" : "↻ Regenerate scene"}
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
