"use client";

import { useState, useTransition } from "react";
import { approveAllOfKind, sceneAction, type ActionResult } from "@/app/actions";
import type { Scene, StatusKind } from "@/lib/data";
import MediaPlayer from "@/components/MediaPlayer";

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
  const [pending, startTransition] = useTransition();

  const active =
    scenes.find((s) => s.id === selectedId) ?? running ?? scenes[0] ?? null;

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
              <MediaPlayer key={active.id} url={active.videoUrl} portrait={portrait} fill />
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
            {scenes.map((s, i) => (
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
          </div>
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

            {!active.imageApproved && (
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
            {active.videoUrl && !active.videoApproved && (
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
              onClick={() => setSelectedId(s.id)}
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
