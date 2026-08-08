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
      <PendingStage.Provider value={pending}>{children}</PendingStage.Provider>
    </SetPendingStage.Provider>
  );
}

/** The step the producer just clicked, before the server has re-rendered. */
export function usePendingStage(): string | null {
  return useContext(PendingStage);
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
