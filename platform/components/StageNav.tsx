"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Instant step switching, ahead of the server.
 *
 * The stepper's links change a `?stage=` param, and the project page is
 * `force-dynamic`: every click re-reads Airtable AND asks n8n what is running
 * before a single pixel changes. Until that round-trip lands, the PREVIOUS
 * step stays on screen — so clicking "Images" showed the clip and the video
 * controls for a second, then swapped. It reads as the app ignoring the click.
 *
 * Nothing about the switch actually needs the server: the panel that serves
 * Images and the one that serves Video are the same mounted component, with
 * the same scene data already in hand. So the click records where it is going
 * and the panel believes it immediately; the server render arrives later and
 * agrees. `current` is the committed stage — when it catches up, the guess is
 * dropped, so a failed or redirected navigation cannot leave the UI lying.
 */
const PendingStage = createContext<string | null>(null);
const SetPendingStage = createContext<(s: string | null) => void>(() => {});
const CurrentStage = createContext<string | null>(null);

export function StageNavProvider({
  current,
  children,
}: {
  /** The stage the server actually rendered (null = the live step). */
  current: string | null;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<string | null>(null);
  // The server caught up — stop guessing.
  useEffect(() => setPending(null), [current]);
  return (
    <SetPendingStage.Provider value={setPending}>
      <CurrentStage.Provider value={current}>
        <PendingStage.Provider value={pending}>{children}</PendingStage.Provider>
      </CurrentStage.Provider>
    </SetPendingStage.Provider>
  );
}

/** The step the producer just clicked, before the server has re-rendered. */
export function usePendingStage(): string | null {
  return useContext(PendingStage);
}

/**
 * For panels that move the producer themselves rather than by a click —
 * pressing render sends them to Assembly. Set this before `router.push` so
 * the stepper highlights the destination straight away.
 */
export function useSetPendingStage(): (s: string | null) => void {
  return useContext(SetPendingStage);
}

/**
 * One card of the stage stepper, and the owner of the answer to "where am I".
 *
 * THE DARK CARD FOLLOWS THE PRODUCER, not the pipeline. It used to mark the
 * active step, with a thin accent ring for the step you clicked — and the
 * ring was too quiet to register, so clicking Images visibly changed nothing
 * and the black card stayed on Video. The producer's words: "apeși și nu-ți
 * dai seama unde ești". Now the card you are ON is the dark one; the step
 * the pipeline is working stays marked by its pulsing accent badge, so the
 * two answers ("where am I" / "where is the machine") each keep a signal
 * instead of fighting over one.
 *
 * A client component so the dark card moves ON THE CLICK, from the same
 * pending guess SceneBoard already believes — the `?stage=` navigation is a
 * full server round-trip, and a highlight that arrives a second late reads
 * as no highlight at all.
 *
 * One known lag, accepted: clicking the dark card again returns to the bare
 * page (pending becomes null, which is also the "no guess" state), so the
 * dark card slides back to the live step only when the server answers. That
 * click means "take me back to whatever is live", so the destination is
 * genuinely the server's to name.
 */
export function StepCard({
  stepKey,
  live,
  state,
  frozen,
  projectId,
  children,
}: {
  stepKey: string;
  /** The pipeline's own position — where the dark card sits when nothing is selected. */
  live: boolean;
  state: string;
  frozen: boolean;
  projectId: string;
  children: ReactNode;
}) {
  const pending = useContext(PendingStage);
  const current = useContext(CurrentStage);
  const setPending = useContext(SetPendingStage);
  const selected = pending ?? current;
  const dark = selected ? selected === stepKey : live;
  const cls = `ps ${state}${dark ? " dark" : ""}${frozen ? " frozen" : ""}`;
  if (frozen) {
    return (
      <span
        className={cls}
        aria-disabled="true"
        title="Locked while the final render is running — stop the render to go back"
      >
        {children}
      </span>
    );
  }
  const isCurrent = current === stepKey;
  return (
    <Link
      href={isCurrent ? `/projects/${projectId}` : `/projects/${projectId}?stage=${stepKey}`}
      className={cls}
      scroll={false}
      aria-current={dark ? "true" : undefined}
      onClick={() => setPending(isCurrent ? null : stepKey)}
    >
      {children}
    </Link>
  );
}

export function StageLink({
  stage,
  href,
  className,
  children,
}: {
  /** Target stage, or null for the bare page (the live step). */
  stage: string | null;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const setPending = useContext(SetPendingStage);
  return (
    <Link
      href={href}
      className={className}
      scroll={false}
      onClick={() => setPending(stage)}
    >
      {children}
    </Link>
  );
}
