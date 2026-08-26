"use client";

import { useState, useTransition } from "react";
import {
  approveAllOfKind,
  cancelVideoRegen,
  reopenStep,
  restartVideoRegen,
  restoreSceneVersion,
  saveImagePrompt,
  saveSceneVersion,
  saveVideoPrompt,
  sceneAction,
  type ActionResult,
} from "@/app/actions";
import type { Scene, StatusKind } from "@/lib/data";
import { mediaSrc } from "@/lib/media";
import { explainRefusal } from "@/lib/refusals";
import MediaPlayer from "@/components/MediaPlayer";
import RegenBadge from "@/components/RegenBadge";
import { usePendingStage } from "@/components/StageNav";

/** The three steps this board can serve, in the pipeline's own order. */
type Step = "images" | "audio" | "video";

/** Has this scene signed off the asset the given step is about? */
function approvedFor(s: Scene, step: Step): boolean {
  return step === "images"
    ? s.imageApproved
    : step === "audio"
      ? s.voiceApproved
      : s.videoApproved;
}

/** Does the asset that step reviews exist yet? */
function assetFor(s: Scene, step: Step): boolean {
  return Boolean(
    step === "images" ? s.imageUrl : step === "audio" ? s.voiceUrl : s.videoUrl,
  );
}

/** Filename-safe stub of a project name, so downloads don't all collide. */
function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project"
  );
}

/**
 * Where "download this clip" points.
 *
 * Scene clips are Drive URLs (`Set Scene Result` writes
 * `uc?export=download&id=…`), so `mediaSrc` already routes them through our
 * own `/api/media` — which makes the link SAME-ORIGIN, and that is what lets
 * the browser honour a filename at all. `dl` additionally asks the proxy for
 * a Content-Disposition, so the file arrives named even when the link is
 * opened rather than clicked.
 *
 * A clip that is not on Drive (older projects, CDN-hosted) is passed through
 * untouched: cross-origin, so the name is ignored and the browser opens it.
 * Still useful, just not a one-click save.
 */
function clipDownload(scene: Scene, projectName: string) {
  const file = `${slug(projectName)}-${slug(scene.label)}.mp4`;
  const src = mediaSrc(scene.videoUrl ?? "");
  return {
    file,
    href: src.startsWith("/api/media")
      ? `${src}&dl=${encodeURIComponent(file)}`
      : src,
  };
}

const approvedRow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

/**
 * The way back into a step that was already signed off.
 *
 * Deliberately quiet — it sits next to the "Approved" chip it undoes, and
 * only appears once there IS an approval to undo. Reopening touches this
 * scene alone, so the rest of the film keeps its sign-off.
 */
function MakeChanges({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="abtn"
      disabled={disabled}
      onClick={onClick}
      style={{ padding: "3px 9px", fontSize: 11.5, lineHeight: 1.4 }}
      title="Reopen this step for this scene only — every other scene keeps its approval"
    >
      ✎ Make changes
    </button>
  );
}

/**
 * How a filmstrip frame reads, for the step being reviewed.
 *
 * It used to be derived from the Airtable status TEXT, which is display-only
 * and lags behind the checkboxes — so a scene could sit green while its image
 * was waiting for a decision, and the strip could not answer the one question
 * it is looked at for: which scenes still need me? Approval is the truth, and
 * it is per-step, so the same scene is green on Images and grey on Video.
 *
 * "q" (dimmed to 45%) is reserved for scenes with nothing generated yet —
 * there is genuinely nothing to look at. A scene AWAITING a decision must
 * stay fully legible: dimming exactly the frames that need attention is
 * backwards, and that is what the old status mapping did.
 */
function frClass(s: Scene, step: Step): string {
  if (s.statusKind === "err") return "err";
  if (approvedFor(s, step)) return "done";
  if (s.statusKind === "run") return "act";
  return assetFor(s, step) ? "todo" : "q";
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
  projectName = "project",
  scenes,
  portrait = false,
  focus = null,
  audioPanel = false,
}: {
  projectId: string;
  /** Only used to name downloaded clips, so files from different films
   *  don't all land in the folder as "scene-S1.mp4". */
  projectName?: string;
  scenes: Scene[];
  portrait?: boolean;
  /**
   * The step being looked at, when the producer stepped back to one.
   *
   * The monitor used to play the clip whenever a clip existed, so revisiting
   * Images showed a video player over the image under review — the wrong
   * asset for the decision being made. null = the live step, where showing
   * the newest asset is right.
   */
  focus?: "images" | "video" | null;
  /**
   * Whether the voice panel (AudioReview) is on the page below.
   *
   * The board never renders the audio step itself, so it may only hand a
   * scene to that step when something is actually there to catch it —
   * otherwise the scene lands on a step that isn't rendered and shows no
   * controls at all.
   */
  audioPanel?: boolean;
}) {
  const running = scenes.find((s) => s.statusKind === "run");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [feedback, setFeedback] = useState("");
  // Shot-direction drafts: the stored text until edited.
  const [videoDrafts, setVideoDrafts] = useState<Record<string, string>>({});
  // Draft being previewed in the big monitor. Comparing a saved take against
  // the live one is the whole point of keeping drafts, and that cannot be
  // done in a 128px card — so the preview borrows the player above.
  const [previewId, setPreviewId] = useState<string | null>(null);
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

  /**
   * Which step's controls this board carries — and only that step's.
   *
   * Every step is its own page now (the stepper links back to each one), so a
   * board that also carried its neighbours' buttons put three unrelated
   * decisions under one heading: the Video page asked you to approve the clip
   * while simultaneously offering to re-record the line and re-roll the
   * picture. Each of those belongs to a page of its own, one click away.
   *
   * `focus` is the page the SERVER rendered; `pendingStage` is the page the
   * producer just clicked. The click wins, because the round-trip re-reads
   * Airtable and n8n before anything changes and the stale step would sit on
   * screen for a second — which looked like the click had been ignored.
   *
   * With neither, this is the live page: the step is the first thing the
   * active scene still owes — voice, then image, then clip, the pipeline's
   * own order. Voice first because the batch synthesizes every take before
   * it generates a single image: takes are the first asset that exists, so
   * they are the first thing worth the producer's attention.
   */
  const pendingStage = usePendingStage();
  const focusNow: "images" | "video" | null =
    pendingStage === "images" || pendingStage === "video" ? pendingStage : focus;
  const step: Step =
    focusNow ??
    (audioPanel && active && !active.voiceApproved
      ? "audio"
      : active && !active.imageApproved
        ? "images"
        : "video");

  // The monitor shows the asset the CURRENT step is deciding on, not simply
  // the newest one that exists. Keying this off `step` rather than `focus`
  // also means the live page already shows the picture when the picture is
  // what a scene still owes — so clicking "Images" changes nothing, instead
  // of flashing the clip first.
  const showClip = step !== "images" && Boolean(active?.videoUrl);
  /**
   * Drafts belonging to the step being reviewed, and only those.
   *
   * The panel listed every saved version of the scene, so standing on Images
   * offered clip drafts to restore — assets that step cannot judge and whose
   * Restore would quietly send the video back for approval from a page about
   * pictures. Each step now sees its own kind; the audio step has none,
   * because takes are not versioned.
   */
  const stepKind: "image" | "video" | null =
    step === "images" ? "image" : step === "video" ? "video" : null;
  const stepVersions =
    stepKind === null
      ? []
      : (active?.versions ?? []).filter((v) => v.kind === stepKind);
  // Resolved against the step's own list, so a preview does not survive
  // switching scene OR step — in both cases the inspector stops listing it.
  const preview = stepVersions.find((v) => v.id === previewId) ?? null;

  // The two blocks this board owns. Voice lives in AudioReview, and the
  // narration itself in SceneReview — neither belongs here.
  const imageControls = step === "images" && !!active && !active.imageApproved;
  const videoControls =
    step === "video" && !!active && !!active.videoUrl && !active.videoApproved;

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

  // Bulk approval is about the assets that EXIST.
  //
  // It used to unlock only once EVERY scene in the project had one, as a
  // guard against approving placeholders. That guard is unreachable on any
  // project past the batch cap: n8n stages CAP=8 scenes at a time, so a
  // 15-scene film permanently has scenes with no picture and no clip, and
  // the button was replaced forever by a "still generating" notice that
  // could never clear. The guard was also redundant — `Evaluate Image
  // Approval` and `Evaluate Voice Approval` in n8n count a scene as approved
  // only when its asset actually exists, so an early sign-off cannot open a
  // gate on something that was never made.
  const withImage = scenes.filter((s) => s.imageUrl);
  const withClip = scenes.filter((s) => s.videoUrl);
  const imagesLater = scenes.length - withImage.length;
  const clipsLater = scenes.length - withClip.length;
  const unapprovedImages = withImage
    .filter((s) => !s.imageApproved)
    .map((s) => s.id);
  const unapprovedVideos = withClip
    .filter((s) => !s.videoApproved)
    .map((s) => s.id);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setMsg(await fn()));

  return (
    <div className="stage">
      <div>
        <div className={`monitor${portrait ? " portrait" : ""}`}>
          <div className={`scr${(preview ? preview.kind === "video" : showClip) ? " video" : ""}`}>
            {preview?.url ? (
              // A draft under review takes the monitor, so it can be judged at
              // the same size as the asset it would replace.
              preview.kind === "video" ? (
                <MediaPlayer key={preview.id} url={preview.url} portrait={portrait} fill />
              ) : (
                <>
                  <div
                    className="art"
                    style={{ backgroundImage: `url(${preview.url})` }}
                  />
                  <span className="tc">{active?.label ?? "—"}</span>
                </>
              )
            ) : showClip && active?.videoUrl ? (
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
                // Selection is its own class: it used to reuse "act", which
                // also paints the blinking amber "generating" dot — so the
                // scene you were looking at could never show its own
                // green/grey approval light.
                className={`fr ${frClass(s, step)} ${s.id === active?.id ? "sel" : ""}`}
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
            {/* All three rows stay — the state of the whole scene is worth
                seeing from any step. Only the row for the step being viewed
                offers its way back in; the others are read-only here and
                reopen from their own page. */}
            <div className="kv">
              <span>Image</span>
              {active.imageApproved ? (
                <span style={approvedRow}>
                  <span className="chip ok">Approved</span>
                  {step === "images" && (
                    <MakeChanges
                      disabled={pending}
                      onClick={() => run(() => reopenStep(projectId, active.id, "images"))}
                    />
                  )}
                </span>
              ) : active.imageUrl ? (
                <span className="chip wait">Awaiting review</span>
              ) : active.regenImage ? (
                <span className="chip run">Regenerating</span>
              ) : (
                // "Awaiting review" on a scene with no picture at all was a
                // straight lie, and on a project past the batch cap it was
                // the state most scenes sat in.
                <span className="chip wait">Not made yet</span>
              )}
            </div>
            {active.voiceUrl && (
              <div className="kv">
                <span>Voice</span>
                {active.voiceApproved ? (
                  <span style={approvedRow}>
                    <span className="chip ok">Approved</span>
                    {step === "audio" && (
                      <MakeChanges
                        disabled={pending}
                        onClick={() => run(() => reopenStep(projectId, active.id, "audio"))}
                      />
                    )}
                  </span>
                ) : (
                  <span className="chip wait">Awaiting review</span>
                )}
              </div>
            )}
            <div className="kv">
              <span>Video</span>
              {active.videoApproved ? (
                <span style={approvedRow}>
                  <span className="chip ok">Approved</span>
                  {step === "video" && (
                    <MakeChanges
                      disabled={pending}
                      onClick={() => run(() => reopenStep(projectId, active.id, "video"))}
                    />
                  )}
                </span>
              ) : active.videoUrl ? (
                <span className="chip wait">Awaiting review</span>
              ) : active.regenVideo ||
                (active.imageApproved && active.voiceApproved) ? (
                // Derived from the checkboxes, never from the status TEXT,
                // which is display-only and lags: a scene with nothing
                // generated reads "Generare Script" there and was being
                // reported as "Rendering".
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

            {imageControls && (
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
                    <div style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 5 }}>
                      Edited — Regenerate saves this prompt and renders it.
                    </div>
                  )}
                {/* Rejection/auto-rewrite reasons must survive outside the
                    regenerating state — a Flow refusal clears the flag but
                    the WHY is exactly what the reviewer needs. */}
                {!active.regenImage &&
                  active.note &&
                  /REJECTED|AUTO-REWRITE|failed|error/i.test(active.note) && (
                    <div className="formmsg err" style={{ marginTop: 8 }}>
                      {active.note}
                      {(() => {
                        const why = explainRefusal(active.note);
                        return why ? (
                          <span
                            style={{ display: "block", marginTop: 5, color: "var(--soft)", fontSize: 12 }}
                          >
                            {why.cause}. {why.advice}
                          </span>
                        ) : null;
                      })()}
                    </div>
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
                  {/* Generation overwrites in place, so this is the only way
                      a picture survives being replaced. */}
                  <button
                    className="abtn"
                    disabled={pending || !active.imageUrl}
                    title="Keep this image, so you can come back to it if the next one is worse"
                    onClick={() =>
                      run(() => saveSceneVersion(projectId, active.id, "image"))
                    }
                  >
                    ⤓ Save draft
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
            {/* The voiceover player, its narration box, "Regenerate voice" and
                "Rewrite the line (AI)" used to sit here, on whichever step the
                board happened to be showing. All four have a home of their
                own: the take belongs to the Audio step (AudioReview, which
                also flags takes that don't fit their shot and can pin a voice
                per scene), and the line belongs to the Scenes step
                (SceneReview's "↻ Regenerate scene"). Nothing was lost by
                dropping them — one click on the stepper reaches either. */}
            {/*
              The way back from a bad re-roll. Every replacing path files the
              outgoing asset here itself, so the list fills without anyone
              pressing anything; "Save draft" is only for keeping one on
              purpose. Exactly one card per kind carries the "Last generation"
              marker — the asset that was live immediately before this one.
            */}
            {stepVersions.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <label
                  style={{ display: "block", fontSize: 12, color: "var(--dim)", marginBottom: 8 }}
                >
                  Saved drafts ({stepVersions.length})
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {[...stepVersions].reverse().map((v) => (
                    <div
                      key={v.id}
                      style={{
                        width: 128,
                        border: `1px solid ${previewId === v.id ? "var(--acc)" : "var(--line2)"}`,
                        borderRadius: 8,
                        overflow: "hidden",
                        background: "var(--bg2)",
                      }}
                    >
                      {/*
                        A clip draft used to be an anonymous ▶ on a grey card,
                        so two saves of the same scene were indistinguishable.
                        A muted <video> seeked just past the start renders its
                        own first frame, which is the only thumbnail we have —
                        nothing in the pipeline produces a poster image.
                      */}
                      <button
                        type="button"
                        onClick={() => setPreviewId(previewId === v.id ? null : v.id)}
                        title="Show this draft in the player above"
                        style={{
                          display: "block",
                          width: "100%",
                          padding: 0,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                        }}
                      >
                        {v.kind === "image" && v.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={v.url}
                            alt=""
                            style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }}
                          />
                        ) : v.url ? (
                          <video
                            src={`${mediaSrc(v.url)}#t=0.5`}
                            muted
                            playsInline
                            preload="metadata"
                            style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }}
                          />
                        ) : (
                          <div style={{ height: 72 }} />
                        )}
                      </button>
                      <div style={{ padding: "6px 7px 7px" }}>
                        <div style={{ fontSize: 10.5, color: "var(--dim)", marginBottom: 5 }}>
                          {v.kind === "image" ? "Image" : "Clip"}
                          {/* One draft per kind is not a date to the producer,
                              it is a place: the thing that was on the scene
                              before this one. Naming it beats timestamping it,
                              and it is the card reached for most. */}
                          {v.last ? (
                            <span style={{ color: "var(--acc)" }}> · Last generation</span>
                          ) : v.at ? (
                            /* For the rest the hour matters more than the
                               date: several drafts of one scene are usually
                               saved minutes apart, and a bare date made them
                               identical. */
                            ` · ${new Date(v.at).toLocaleString(undefined, {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`
                          ) : (
                            ""
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="abtn"
                            style={{ padding: "3px 6px", fontSize: 11, flex: 1 }}
                            onClick={() => setPreviewId(previewId === v.id ? null : v.id)}
                          >
                            {previewId === v.id ? "Close" : "Preview"}
                          </button>
                          <button
                            className="abtn"
                            disabled={pending}
                            style={{ padding: "3px 6px", fontSize: 11, flex: 1 }}
                            title={v.prompt ?? undefined}
                            onClick={() =>
                              run(() => restoreSceneVersion(projectId, active.id, v.id))
                            }
                          >
                            Restore
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
                  Every regeneration files the asset it replaces here on its
                  own — <span style={{ color: "var(--acc)" }}>Last generation</span>{" "}
                  is the one that was on this scene just before the current
                  one. The button is for keeping any other on purpose.
                  Restoring brings back the prompt it was made with too, and
                  sends it for approval again.
                </p>
              </div>
            )}
            {/*
              What the clip is told to DO. Scripting writes it once and
              nothing else ever touches it — not the narration, not the image
              prompt — so a rewritten scene used to be shot to the original
              direction, with no field on screen to explain why. On a silent
              film it is the whole story, since the narration is neither
              spoken nor captioned.
            */}
            {!active.videoApproved && active.videoPrompt !== null && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <label
                  style={{ display: "block", fontSize: 12, color: "var(--dim)", marginBottom: 6 }}
                >
                  Shot direction (what happens in the clip)
                </label>
                <textarea
                  value={videoDrafts[active.id] ?? active.videoPrompt ?? ""}
                  onChange={(e) =>
                    setVideoDrafts((p) => ({ ...p, [active.id]: e.target.value }))
                  }
                  rows={4}
                  spellCheck={false}
                  style={{
                    width: "100%",
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
                <div className="abtns" style={{ marginTop: 8 }}>
                  <button
                    className="abtn"
                    disabled={
                      pending ||
                      (videoDrafts[active.id] ?? active.videoPrompt ?? "") ===
                        (active.videoPrompt ?? "")
                    }
                    onClick={() =>
                      run(async () => {
                        const r = await saveVideoPrompt(
                          projectId,
                          active.id,
                          videoDrafts[active.id] ?? "",
                        );
                        if (r.ok)
                          setVideoDrafts((p) => {
                            const n = { ...p };
                            delete n[active.id];
                            return n;
                          });
                        return r;
                      })
                    }
                  >
                    Save shot direction
                  </button>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
                  This is what the clip is generated from — editing the
                  narration or the image prompt does not change it.
                </p>
              </div>
            )}
            {videoControls && (
              active.regenVideo ? (
                <>
                  <RegenBadge label="Regenerating video…" note={active.note} />
                  {/*
                    This state is cleared from inside a media-generation run,
                    and video regen is the one regeneration with no webhook of
                    its own — the flag is only ever seen by a batch that is
                    alive AND still polling the video gate. It strands more
                    easily than its siblings, and the badge replaces the whole
                    button row, so without these two the scene cannot be
                    approved, redone, or let go. Approving an image now queues
                    a clip automatically, which makes the state common enough
                    that it had to stop being a dead end.
                  */}
                  <div className="abtns" style={{ marginTop: 10 }}>
                    <button
                      className="abtn"
                      disabled={pending}
                      onClick={() => run(() => restartVideoRegen(projectId, active.id))}
                    >
                      ⟳ Send it again
                    </button>
                    <button
                      className="abtn"
                      disabled={pending}
                      onClick={() => run(() => cancelVideoRegen(projectId, active.id))}
                    >
                      Cancel — keep this clip
                    </button>
                  </div>
                </>
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
                  disabled={pending || !active.videoUrl}
                  title="Keep this clip, so you can come back to it if the next one is worse"
                  onClick={() =>
                    run(() => saveSceneVersion(projectId, active.id, "video"))
                  }
                >
                  ⤓ Save draft
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
                {/* Same-origin through /api/media, which is what makes the
                    filename stick — see clipDownload. */}
                <a
                  className="abtn"
                  href={clipDownload(active, projectName).href}
                  download={clipDownload(active, projectName).file}
                  title="Save this scene's clip"
                >
                  ⤓ Download
                </a>
              </div>
              )
            )}
            {(imageControls || videoControls) && (
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

        {/* Bulk review belongs to ONE step, like every other control here.
            It used to fall through a single chain of conditions, so the
            Images step — with its last image still unreviewed, hence no
            images branch to take — landed on "Approve all 6 videos": a
            one-click sign-off of the entire next stage, offered from the
            page before it. */}
        {step === "images" && unapprovedImages.length > 1 && (
          <div className="card">
            <h5>Bulk review</h5>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
              {unapprovedImages.length} of the {withImage.length} pictures made
              so far still need review. Regenerate individual scenes first if
              needed.
              {imagesLater > 0 && (
                <>
                  {" "}
                  The other {imagesLater} scene{imagesLater === 1 ? "" : "s"}{" "}
                  {imagesLater === 1 ? "is" : "are"} drawn in a later pass —
                  production works through the film a batch at a time.
                </>
              )}
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
          </div>
        )}

        {step === "video" && unapprovedVideos.length > 1 && (
          <div className="card">
            <h5>Bulk review</h5>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
              {unapprovedVideos.length} of the {withClip.length} clips rendered
              so far still need review.
              {clipsLater > 0 && (
                <>
                  {" "}
                  The other {clipsLater} scene{clipsLater === 1 ? "" : "s"}{" "}
                  {clipsLater === 1 ? "is" : "are"} filmed in a later pass, which
                  starts once these are signed off.
                </>
              )}
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
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {/* One per scene, on the Video step only — that is the step
                    this list is being read on when clips are what you want,
                    and every other step has nothing to save yet. The click
                    must not also select the row it sits in. */}
                {step === "video" && s.videoUrl && (
                  <a
                    className="dlmini"
                    href={clipDownload(s, projectName).href}
                    download={clipDownload(s, projectName).file}
                    onClick={(e) => e.stopPropagation()}
                    title={`Save ${s.label} as ${clipDownload(s, projectName).file}`}
                    aria-label={`Download ${s.label}`}
                  >
                    ⤓
                  </a>
                )}
                <span className={`chip ${chipClass(s.statusKind)}`}>{s.status}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
