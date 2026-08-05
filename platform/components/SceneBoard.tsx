"use client";

import { useState, useTransition } from "react";
import {
  approveAllOfKind,
  regenerateVoice,
  saveImagePrompt,
  sceneAction,
  type ActionResult,
} from "@/app/actions";
import type { Scene, StatusKind } from "@/lib/data";
import MediaPlayer from "@/components/MediaPlayer";
import RegenBadge from "@/components/RegenBadge";

function frClass(kind: StatusKind): string {
  switch (kind) {
    case "done":
      return "done";
    case "run":
      return "act";
    case "err":
      return "err";
    default:
      return "q";
  }
}

function chipClass(kind: StatusKind): string {
  switch (kind) {
    case "done":
      return "ok";
    case "run":
      return "run";
    case "err":
      return "err";
    default:
      return "wait";
  }
}

export default function SceneBoard({
  projectId,
  scenes,
  portrait = false,
}: {
  projectId: string;
  scenes: Scene[];
  portrait?: boolean;
}) {
  const running = scenes.find((s) => s.statusKind === "run");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [feedback, setFeedback] = useState("");
  // Narration drafts per scene for the voice editor (falls back to the
  // stored text until edited).
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, string>>({});
  // Image-prompt drafts, kept in sessionStorage so the 10s auto-refresh
  // can't quietly reset a rewritten prompt to the stored one.
  const promptKey = `vf-imgprompt-drafts:${projectId}`;
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(promptKey) ?? "{}");
    } catch {
      return {};
    }
  });
  const setPromptDraft = (sceneId: string, v: string) =>
    setPromptDrafts((prev) => {
      const next = { ...prev, [sceneId]: v };
      try {
        sessionStorage.setItem(promptKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  const dropPromptDraft = (sceneId: string) =>
    setPromptDrafts((prev) => {
      const next = { ...prev };
      delete next[sceneId];
      try {
        sessionStorage.setItem(promptKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  const [pending, startTransition] = useTransition();

  const active =
    scenes.find((s) => s.id === selectedId) ?? running ?? scenes[0] ?? null;

  // A 44-scene project turned the filmstrip into a wall of unreadable
  // thumbnails. Page it by 8 with arrows; picking a scene from the list in
  // the inspector jumps the strip to that scene's page.
  const PAGE_SIZE = 8;
  const pageCount = Math.max(1, Math.ceil(scenes.length / PAGE_SIZE));
  const activeIndex = Math.max(
    0,
    scenes.findIndex((s) => s.id === active?.id),
  );
  const [pageRaw, setPage] = useState(() => Math.floor(activeIndex / PAGE_SIZE));
  const page = Math.min(pageRaw, pageCount - 1);
  const select = (id: string) => {
    setSelectedId(id);
    const i = scenes.findIndex((s) => s.id === id);
    if (i >= 0) setPage(Math.floor(i / PAGE_SIZE));
  };
  const visible = scenes
    .map((s, i) => ({ s, i }))
    .slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Bulk approval only unlocks once EVERY scene has the asset generated —
  // approving placeholders early used to open the n8n gate prematurely and
  // start the next phase with missing images.
  const imagesMissing = scenes.filter((s) => !s.imageUrl).length;
  const clipsMissing = scenes.filter((s) => !s.videoUrl).length;
  const unapprovedImages = scenes
    .filter((s) => s.imageUrl && !s.imageApproved)
    .map((s) => s.id);
  const unapprovedVideos = scenes
    .filter((s) => s.videoUrl && !s.videoApproved)
    .map((s) => s.id);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setMsg(await fn()));

  return (
    <div className="stage">
      <div>
        <div className={`monitor${portrait ? " portrait" : ""}`}>
          <div className={`scr${active?.videoUrl ? " video" : ""}`}>
            {active?.videoUrl ? (
              // The clip plays in the big monitor so the whole frame is
              // visible; the inspector keeps only the approve/regen controls.
              <MediaPlayer
                key={active.id}
                url={active.videoUrl}
                audioUrl={active.voiceUrl}
                portrait={portrait}
                fill
              />
            ) : (
              <>
                <div
                  className={`art ${active?.imageUrl ? "" : "fallback1"}`}
                  style={
                    active?.imageUrl
                      ? { backgroundImage: `url(${active.imageUrl})` }
                      : undefined
                  }
                />
                <span className="tc">{active?.label ?? "—"}</span>
                <div className="cap">
                  <h4>{active?.narration?.slice(0, 70) ?? "No scene selected"}</h4>
                  <p>{active?.status}</p>
                </div>
              </>
            )}
          </div>
          <div className="filmstrip">
            {pageCount > 1 && (
              <button
                className="fsnav"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                aria-label="Previous scenes"
              >
                ‹
              </button>
            )}
            {visible.map(({ s, i }) => (
              <div
                className={`fr ${frClass(s.statusKind)} ${s.id === active?.id ? "act" : ""}`}
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedId(s.id)}
              >
                <div
                  className={`art ${s.imageUrl ? "" : `fallback${(i % 4) + 1}`}`}
                  style={
                    s.imageUrl ? { backgroundImage: `url(${s.imageUrl})` } : undefined
                  }
                />
                <span className="n">{s.label}</span>
                <span className="dot" />
              </div>
            ))}
            {pageCount > 1 && (
              <button
                className="fsnav"
                onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
                disabled={page === pageCount - 1}
                aria-label="Next scenes"
              >
                ›
              </button>
            )}
          </div>
          {pageCount > 1 && (
            <div className="fspage">
              Scenes {page * PAGE_SIZE + 1}–
              {Math.min(scenes.length, (page + 1) * PAGE_SIZE)} of {scenes.length}
            </div>
          )}
        </div>
      </div>

      <div className="insp">
        {msg && (
          <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>
        )}

        {active && (
          <div className="card">
            <h5>{active.label} · Inspector</h5>
            <div className="kv">
              <span>Image</span>
              {active.imageApproved ? (
                <span className="chip ok">Approved</span>
              ) : (
                <span className="chip wait">Awaiting review</span>
              )}
            </div>
            <div className="kv">
              <span>Video</span>
              {active.videoApproved ? (
                <span className="chip ok">Approved</span>
              ) : active.videoUrl ? (
                <span className="chip wait">Awaiting review</span>
              ) : active.statusKind === "run" ? (
                <span className="chip run">Rendering</span>
              ) : (
                <span className="chip wait">Queued</span>
              )}
            </div>
            <div className="kv">
              <span>Status</span>
              <b>{active.status}</b>
            </div>
            {active.evidenceRef && (
              <div className="kv">
                <span>Evidence</span>
                <span className="chip ok" title="Sourced claims backing this scene — full sources in the Airtable Evidence table">
                  {active.evidenceRef}
                </span>
              </div>
            )}
            {active.needsFactCheck && (
              <p className="formmsg err" style={{ marginTop: 8 }}>
                Fact check needed — this scene states a fact the research pack
                could not back with a source. Verify the narration by hand.
              </p>
            )}

            {!active.imageApproved && (
              <>
                <label
                  style={{ display: "block", fontSize: 12, color: "var(--dim)", margin: "14px 0 6px" }}
                >
                  Image prompt — edit it and Regenerate to render exactly this
                </label>
                <textarea
                  value={promptDrafts[active.id] ?? active.imagePrompt ?? ""}
                  onChange={(e) => setPromptDraft(active.id, e.target.value)}
                  rows={6}
                  spellCheck={false}
                  style={{
                    width: "100%",
                    background: "var(--bg2)",
                    border: "1px solid var(--line2)",
                    borderRadius: 10,
                    color: "var(--ink)",
                    font: "inherit",
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    padding: "10px 12px",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
                {promptDrafts[active.id] !== undefined &&
                  promptDrafts[active.id] !== (active.imagePrompt ?? "") && (
                    <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 5 }}>
                      Edited — Regenerate saves this prompt and renders it.
                    </div>
                  )}
                {/* Rejection/auto-rewrite reasons must survive outside the
                    regenerating state — a Flow refusal clears the flag but
                    the WHY is exactly what the reviewer needs. */}
                {!active.regenImage &&
                  active.note &&
                  /REJECTED|AUTO-REWRITE|failed|error/i.test(active.note) && (
                    <p className="formmsg err" style={{ marginTop: 8 }}>
                      {active.note}
                    </p>
                  )}
                {active.regenImage ? (
                  <RegenBadge label="Regenerating image…" note={active.note} />
                ) : (
                <div className="abtns">
                  <button
                    className="abtn ok"
                    disabled={pending}
                    onClick={() =>
                      run(() => sceneAction(projectId, active.id, "image", "approve"))
                    }
                  >
                    Approve image
                  </button>
                  <button
                    className="abtn"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        // Save the rewritten prompt FIRST — n8n reads
                        // "Imagine First Frame" when it regenerates, so the
                        // edit has to be in Airtable before the flag flips.
                        const draft = promptDrafts[active.id];
                        if (draft !== undefined && draft !== (active.imagePrompt ?? "")) {
                          const s = await saveImagePrompt(projectId, active.id, draft);
                          if (!s.ok) return s;
                          dropPromptDraft(active.id);
                        }
                        const r = await sceneAction(
                          projectId,
                          active.id,
                          "image",
                          "regenerate",
                          feedback,
                        );
                        if (r.ok) setFeedback("");
                        return r;
                      })
                    }
                  >
                    Regenerate
                  </button>
                </div>
                )}
              </>
            )}
            {active.voiceUrl && !active.videoApproved && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <label
                  style={{ display: "block", fontSize: 12, color: "var(--dim)", marginBottom: 6 }}
                >
                  Voiceover — listen, edit the narration, regenerate if needed
                </label>
                {/* Native player via our Railway media proxy — Drive's embed
                    player overlaps its own controls at this column width. */}
                <audio
                  key={`voice-${active.id}-${active.voiceUrl}`}
                  controls
                  preload="none"
                  src={`https://n8n-production-55dd.up.railway.app/media?id=${
                    active.voiceUrl.match(/[?&]id=([\w-]+)/)?.[1] ?? ""
                  }`}
                  style={{ width: "100%", height: 40, display: "block" }}
                />
                <textarea
                  value={voiceDrafts[active.id] ?? active.narration ?? ""}
                  onChange={(e) =>
                    setVoiceDrafts((p) => ({ ...p, [active.id]: e.target.value }))
                  }
                  rows={3}
                  spellCheck={false}
                  style={{
                    width: "100%",
                    marginTop: 10,
                    background: "var(--bg2)",
                    border: "1px solid var(--line2)",
                    borderRadius: 10,
                    color: "var(--ink)",
                    font: "inherit",
                    fontSize: 13,
                    lineHeight: 1.6,
                    padding: "10px 12px",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
                {active.regenVoice ? (
                  <RegenBadge label="Regenerating voice…" note={active.note} />
                ) : (
                  <div className="abtns" style={{ marginTop: 8 }}>
                    <button
                      className="abtn"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          regenerateVoice(
                            projectId,
                            active.id,
                            voiceDrafts[active.id] ?? active.narration ?? "",
                          ),
                        )
                      }
                    >
                      🎙 Regenerate voice
                    </button>
                  </div>
                )}
                <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
                  New voice is synthesized from the text above and re-muxed onto
                  the existing clip — image and video are NOT regenerated.
                </p>
              </div>
            )}
            {active.videoUrl && !active.videoApproved && (
              active.regenVideo ? (
                <RegenBadge label="Regenerating video…" note={active.note} />
              ) : (
              <div className="abtns">
                <button
                  className="abtn ok"
                  disabled={pending}
                  onClick={() =>
                    run(() => sceneAction(projectId, active.id, "video", "approve"))
                  }
                >
                  Approve video
                </button>
                <button
                  className="abtn"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await sceneAction(
                        projectId,
                        active.id,
                        "video",
                        "regenerate",
                        feedback,
                      );
                      if (r.ok) setFeedback("");
                      return r;
                    })
                  }
                >
                  Regenerate video
                </button>
              </div>
              )
            )}
            {(!active.imageApproved || (active.videoUrl && !active.videoApproved)) && (
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Optional: what should change on regeneration? (e.g. “more light, camera closer to the character”)"
                rows={2}
                style={{
                  width: "100%",
                  marginTop: 12,
                  background: "var(--bg2)",
                  border: "1px solid var(--line2)",
                  borderRadius: 10,
                  color: "var(--ink)",
                  font: "inherit",
                  fontSize: 13,
                  padding: "10px 12px",
                  resize: "vertical",
                  outline: "none",
                }}
              />
            )}
          </div>
        )}

        {(unapprovedImages.length > 1 || unapprovedVideos.length > 1 || imagesMissing > 0) && (
          <div className="card">
            <h5>Bulk review</h5>
            {imagesMissing > 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--soft)" }}>
                {imagesMissing} image{imagesMissing === 1 ? " is" : "s are"} still
                generating — bulk approval unlocks when every scene has its
                image, so nothing starts half-done. You can still approve
                finished scenes one by one.
              </p>
            ) : unapprovedImages.length > 1 ? (
              <>
                <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
                  All {scenes.length} images are generated, {unapprovedImages.length} still
                  need review. Regenerate individual scenes first if needed.
                </p>
                <button
                  className="abtn ok"
                  style={{ width: "100%" }}
                  disabled={pending}
                  onClick={() =>
                    run(() => approveAllOfKind(projectId, unapprovedImages, "image"))
                  }
                >
                  Approve all {unapprovedImages.length} images
                </button>
              </>
            ) : clipsMissing > 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--soft)" }}>
                {clipsMissing} video clip{clipsMissing === 1 ? " is" : "s are"} still
                generating — bulk approval unlocks when every scene has its
                clip.
              </p>
            ) : (
              <>
                <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
                  All {scenes.length} clips are generated, {unapprovedVideos.length} still
                  need review.
                </p>
                <button
                  className="abtn ok"
                  style={{ width: "100%" }}
                  disabled={pending}
                  onClick={() =>
                    run(() => approveAllOfKind(projectId, unapprovedVideos, "video"))
                  }
                >
                  Approve all {unapprovedVideos.length} videos
                </button>
              </>
            )}
          </div>
        )}

        <div className="card">
          <h5>Scenes</h5>
          {scenes.map((s) => (
            <div
              className="kv"
              key={s.id}
              onClick={() => select(s.id)}
              style={{ cursor: "pointer" }}
            >
              <span>
                {s.label} · {s.narration?.slice(0, 26) ?? "—"}
              </span>
              <span className={`chip ${chipClass(s.statusKind)}`}>{s.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
