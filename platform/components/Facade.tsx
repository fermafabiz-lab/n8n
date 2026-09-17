"use client";

/**
 * The house behind the login form.
 *
 * /login is the only page outside the password gate, so it is also the only
 * page every bot and every cold visit pays for. The order here is deliberate:
 * the form and a painted dusk render immediately from the server, and the
 * WebGL house arrives afterwards, in its own chunk, only if it is wanted.
 *
 * "Wanted" means: there is a WebGL context, and the visitor has not asked for
 * reduced motion. The drifting camera and the breathing amber windows are the
 * whole point of the scene, so honouring that preference means not mounting it
 * at all rather than freezing it — a still 3D house is just a worse version of
 * the painted one underneath.
 *
 * The lit windows are drawn twice, here in CSS and again in WebGL, from the
 * one `windowStates()` owner. That is on purpose: the readout is the idea, and
 * it should survive the absence of a GPU.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { windowStates, type WindowState } from "@/lib/facade";

import styles from "./Facade.module.css";

// ssr:false keeps three.js out of the server render and out of the first load.
const FacadeScene = dynamic(() => import("./FacadeScene"), { ssr: false });

/** Does a scene belong on this device, for this visitor? */
function wanted(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    // Asking for the context is the only honest test — a browser can advertise
    // WebGL and still fail to give you one (blocklisted driver, too many live
    // contexts, software rendering switched off).
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export default function Facade({
  counts,
}: {
  counts: { run: number; wait: number; err: number } | null;
}) {
  const lights: WindowState[] = windowStates(counts);

  // Decided in an effect, never during render: the server has no `window`, and
  // branching on it during render is a hydration mismatch.
  const [gl, setGl] = useState(false);
  useEffect(() => setGl(wanted()), []);

  return (
    <div className={styles.facade}>
      <div className={styles.painted} aria-hidden="true">
        <div className={styles.house}>
          <div className={styles.roof} />
          <div className={styles.windows}>
            {lights.map((state, i) => (
              <i key={i} data-lit={state} />
            ))}
          </div>
          <div className={styles.door} />
        </div>
      </div>

      {gl && <FacadeScene lights={lights} />}

      {/*
        The one thing on the façade that is not decoration. Screen readers get
        the readout as a sentence; everything else above is aria-hidden.
      */}
      <p className={styles.sr}>
        {counts
          ? `${counts.wait} waiting on you, ${counts.run} in production, ${counts.err} failed.`
          : "Production status is unavailable."}
      </p>
    </div>
  );
}
