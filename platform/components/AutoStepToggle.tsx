"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAutoApproveStep } from "@/app/actions";
import { AUTO_STEP_LABELS, type AutoStep } from "@/lib/hands-off";

/**
 * "Auto-accept this step" — hands-off for the step on screen, for when it was
 * not chosen on the brief (the producer's ask, 2026-09-24: "in caz ca uit sa
 * dau la pagina de Start a new video").
 *
 * One button per step the page is showing — usually one; two on the live page
 * while takes and images are reviewed side by side. Pressing it adds the step
 * to the film's hands-off list; AutoPilot, which the page mounts as soon as
 * any step is on, signs off what is already waiting within seconds and
 * everything that lands after it. It never approves anything itself: the
 * approving stays in `autoApproveTick`, through the same actions the buttons
 * call, so there is one hand and not two.
 *
 * An automatic step says so where the button was, with Stop beside it — an
 * automation must be visible on the very screen it acts on, and one click
 * from undone.
 */
export default function AutoStepToggle({
  projectId,
  steps,
  on,
}: {
  projectId: string;
  /** The steps shown on the page right now, in pipeline order. */
  steps: AutoStep[];
  /** The film's hands-off list. */
  on: AutoStep[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  if (steps.length === 0) return null;

  const flip = (step: AutoStep, next: boolean) =>
    start(async () => {
      const r = await setAutoApproveStep(projectId, step, next);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });

  return (
    <div className="autostep" role="group" aria-label="Auto-accept">
      {steps.map((st) => {
        const label = AUTO_STEP_LABELS[st];
        return on.includes(st) ? (
          <span className="as-on" key={st}>
            <span className="as-dot" aria-hidden />
            <span>
              <b>{label}</b> accepts itself as it lands
            </span>
            <button type="button" className="as-stop" disabled={pending} onClick={() => flip(st, false)}>
              Stop
            </button>
          </span>
        ) : (
          <button
            type="button"
            key={st}
            className="as-btn"
            disabled={pending}
            title={
              st === "final"
                ? "Starts the final render by itself, with the settings saved for this film, as soon as the film reaches Final touches. Undo any time before that."
                : `Signs off ${label} by itself — what is waiting now and everything that lands after it. Undo any time.`
            }
            onClick={() => flip(st, true)}
          >
            ⚡ {steps.length > 1 ? `Auto-accept ${label}` : "Auto-accept this step"}
          </button>
        );
      })}
      {msg && (
        <span className={`as-msg ${msg.ok ? "" : "err"}`} role="status">
          {msg.text}
        </span>
      )}
    </div>
  );
}
