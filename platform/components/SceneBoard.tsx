"use client";

import { useState, useTransition } from "react";
import { approveAllImages, sceneAction, type ActionResult } from "@/app/actions";
import type { Scene, StatusKind } from "@/lib/data";

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
}: {
  projectId: string;
  scenes: Scene[];
}) {
  const running = scenes.find((s) => s.statusKind === "run");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const active =
    scenes.find((s) => s.id === selectedId) ?? running ?? scenes[0] ?? null;
  const unapproved = scenes.filter((s) => !s.imageApproved).map((s) => s.id);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setMsg(await fn()));

  return (
    <div className="stage">
      <div>
        <div className="monitor">
          <div className="scr">
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
              {active.videoUrl ? (
                <span className="chip ok">Ready</span>
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
                    run(() => sceneAction(projectId, active.id, "image", "regenerate"))
                  }
                >
                  Regenerate
                </button>
              </div>
            )}
            {active.imageApproved && active.videoUrl && (
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
                    run(() => sceneAction(projectId, active.id, "video", "regenerate"))
                  }
                >
                  Regenerate video
                </button>
              </div>
            )}
            {active.videoUrl && (
              <div style={{ marginTop: 14 }}>
                <a
                  className="abtn"
                  style={{ display: "block" }}
                  href={active.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  ▶ Watch scene video
                </a>
              </div>
            )}
          </div>
        )}

        {unapproved.length > 1 && (
          <div className="card">
            <h5>Bulk review</h5>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
              {unapproved.length} images are waiting. Approve everything that
              looks right in one go — regenerate individual scenes first if
              needed.
            </p>
            <button
              className="abtn ok"
              style={{ width: "100%" }}
              disabled={pending}
              onClick={() => run(() => approveAllImages(projectId, unapproved))}
            >
              Approve all {unapproved.length} images
            </button>
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
