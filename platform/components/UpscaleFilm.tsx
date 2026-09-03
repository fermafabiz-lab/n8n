"use client";

import { useState, useTransition } from "react";
import { upscaleFilm, type ActionResult } from "@/app/actions";

/**
 * Upscaling a finished film, with the three facts that decide which button to
 * press printed next to the buttons rather than learned afterwards.
 *
 * The costs are not decoration. 1080p upscaling is free and 4K is 50 credits
 * per clip, so an eighty-scene film at 4K spends 4,000 of the 25,050 credits a
 * month — a number worth seeing before the click, which is why 4K asks twice.
 * And rebuilding the film costs about double the render time (measured: 0.107s
 * per frame at 720p against 0.224s at 1080p), while upscaling the clips alone
 * costs nothing and still improves the picture, because the canvas then has
 * less scaling to do. That is why "clips only" is offered as its own answer
 * and not hidden as a checkbox.
 *
 * A film whose clips predate 2026-09-04 cannot be upscaled at all — the Flow
 * media id was extracted and thrown away until then — so the panel says so
 * instead of letting the producer wait for a job that will find nothing.
 */
export default function UpscaleFilm({
  projectId,
  sceneCount,
}: {
  projectId: string;
  sceneCount: number;
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [confirm4k, setConfirm4k] = useState(false);
  const [pending, startTransition] = useTransition();

  const fire = (resolution: "1080p" | "4K", reassemble: boolean) =>
    startTransition(async () => {
      setConfirm4k(false);
      setMsg(await upscaleFilm(projectId, resolution, reassemble));
    });

  const credits4k = sceneCount > 0 ? sceneCount * 50 : null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h5>Resolution</h5>

      <button
        className="btn"
        style={{ width: "100%", marginTop: 8 }}
        disabled={pending}
        onClick={() => fire("1080p", true)}
      >
        {pending ? "…" : "Upscale film to 1080p"}
      </button>
      <p style={{ margin: "4px 0 10px", fontSize: 11.5, color: "var(--dim)" }}>
        Free. Every clip goes up, then the film is rebuilt from them — the
        rebuild takes about twice as long as a normal render.
      </p>

      <button
        className="btn ghost"
        style={{ width: "100%" }}
        disabled={pending}
        onClick={() => fire("1080p", false)}
      >
        {pending ? "…" : "Upscale the clips only"}
      </button>
      <p style={{ margin: "4px 0 10px", fontSize: 11.5, color: "var(--dim)" }}>
        Free and quick. Sharper source for every scene, the finished film left
        as it is — rebuild it later and it comes out cleaner.
      </p>

      {confirm4k ? (
        <>
          <button
            className="btn gold"
            style={{ width: "100%" }}
            disabled={pending}
            onClick={() => fire("4K", true)}
          >
            {pending
              ? "…"
              : `Yes — spend ${credits4k ? credits4k.toLocaleString() : "50 per scene"} credits`}
          </button>
          <p style={{ margin: "4px 0 10px", fontSize: 11.5, color: "var(--dim)" }}>
            4K costs 50 credits per clip
            {credits4k ? `, so ${sceneCount} scenes is ${credits4k.toLocaleString()}` : ""} of
            the 25,050 this account gets each month. They do not roll over, and
            the rebuild still takes about twice a normal render.{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => setConfirm4k(false)}
            >
              Cancel
            </button>
          </p>
        </>
      ) : (
        <>
          <button
            className="btn ghost"
            style={{ width: "100%" }}
            disabled={pending}
            onClick={() => setConfirm4k(true)}
          >
            Upscale film to 4K…
          </button>
          <p style={{ margin: "4px 0 10px", fontSize: 11.5, color: "var(--dim)" }}>
            Costs credits — {credits4k ? `${credits4k.toLocaleString()} for this film` : "50 per scene"}. Asks
            again before spending them.
          </p>
        </>
      )}

      {msg && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: msg.ok ? "var(--dim)" : "var(--bad, #b00)",
          }}
        >
          {msg.message}
        </p>
      )}
      <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
        Only clips generated from 4 September 2026 can be upscaled: before
        that, the identity Google needs was not stored. An older film reports
        that instead of doing anything.
      </p>
    </div>
  );
}
