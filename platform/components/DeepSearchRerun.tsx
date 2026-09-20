"use client";

/**
 * The one control the Deep Search panel has.
 *
 * The panel was built with NO buttons on purpose — the producer's call was
 * "warn loudly, never block", and a control under a warning invites the
 * reflex of pressing it instead of reading. This one earns its place for a
 * different reason: the first pass cannot see the whole film. `Generate Hook`
 * runs after the Deep Search chain, so the hook has never been checked on any
 * film, and nothing re-reads what the rewrite produced. Pressing this checks
 * the script as it now stands, which is the only text that has both.
 *
 * IT CORRECTS WHAT IT FINDS, since 2026-09-19 — the producer's instruction was
 * that a re-check which only reports leaves them to do the fixing by hand. So
 * the chain now rewrites the sentences nothing can back, in the script text and
 * in the hook's spoken copy, exactly as the first pass does. It still never
 * blocks: the gate stays open and Approve is untouched.
 *
 * WHICH IS WHY THIS WAITS. The webhook answers `onReceived`, so pressing the
 * button changes nothing on screen for about a minute — and when the answer
 * does land it has changed the text in the box below. A page that quietly
 * kept showing the old script under a report saying "the corrections are
 * already in" would be the exact shape of this project's oldest fault: the
 * artifact on screen outliving the fix. So the button watches for the new
 * report and reloads the page the moment the script has actually moved.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rerunDeepSearch, type ActionResult } from "@/app/actions";

/** How often to look for the new report, and for how long. */
const POLL_MS = 4000;
const GIVE_UP_MS = 3 * 60 * 1000;

/** The sentinel for "this film has no report at all yet". */
const NOTHING = "\u0000none";

export default function DeepSearchRerun({
  projectId,
  scriptId,
  checkedAt,
  rewritten,
}: {
  projectId: string;
  /**
   * The script row this panel sits above. Only used to find the producer's
   * unsaved draft — `ScriptReview` keeps one in sessionStorage under this key
   * and restores it over the server's text on every remount, so a correction
   * landing under a stale draft would be invisible.
   */
  scriptId?: string;
  /** When the report on screen was written. The thing we watch for. */
  checkedAt?: string | null;
  /** Sentences the report on screen says were corrected. */
  rewritten?: number;
}) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<ActionResult | null>(null);
  const [armed, setArmed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const router = useRouter();

  // The report that was on screen when the button was pressed. `null` means we
  // are not watching; anything else is the stamp the new report must differ
  // from. A ref rather than state because the polling effect must not restart
  // every time it changes.
  const since = useRef<string | null>(null);
  const draftKey = scriptId ? `vf-script-draft:${scriptId}` : null;

  const hasDraft = () => {
    if (!draftKey) return false;
    try {
      return sessionStorage.getItem(draftKey) !== null;
    } catch {
      return false;
    }
  };

  // Look for the new report. `router.refresh()` re-runs the server render and
  // hands this component a new `checkedAt` prop; the effect below notices.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > GIVE_UP_MS) {
        setWaiting(false);
        setSlow(true);
        return;
      }
      // Unlike `AutoRefresh` this does NOT pause on a hidden tab: the producer
      // pressing this button and switching away is the normal case, and the
      // whole point is that the answer is here when they come back.
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [waiting, router]);

  // The new report landed.
  useEffect(() => {
    if (!waiting || since.current === null) return;
    const now = checkedAt || NOTHING;
    if (now === since.current) return;

    setWaiting(false);
    since.current = null;

    // THE SCRIPT MOVED, so the page has to be rebuilt rather than re-rendered.
    // `ScriptReview` seeds its textarea from `content` ONCE, on mount, and
    // restores any sessionStorage draft over it — so a soft refresh leaves the
    // old wording in the box under a report announcing the correction. A full
    // reload with the stale draft dropped is the only way the producer reads
    // what was actually written.
    if ((rewritten ?? 0) > 0) {
      if (draftKey) {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {}
      }
      window.location.reload();
      return;
    }

    setSaid({
      ok: true,
      message: "Re-checked. Nothing needed changing — the report below is the new one.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedAt, rewritten, waiting]);

  const fire = () =>
    start(async () => {
      setArmed(false);
      setSlow(false);
      const r = await rerunDeepSearch(projectId);
      setSaid(r);
      if (r.ok) {
        since.current = checkedAt || NOTHING;
        setWaiting(true);
      } else {
        // A `not-documentary` or misconfigured answer should land on a page
        // that agrees with it.
        router.refresh();
      }
    });

  const busy = pending || waiting;

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="btn ghost"
        disabled={busy}
        onClick={() => {
          // ARMED WHEN THERE IS SOMETHING TO LOSE. The re-check reads the
          // SAVED script, not what is in the box, and if it corrects anything
          // this page reloads onto that correction — so an unsaved edit would
          // vanish without ever having been checked. Same shape as Pause's
          // "sure?", and for the same reason: the cost is invisible until it
          // has happened.
          if (!armed && hasDraft()) {
            setArmed(true);
            return;
          }
          fire();
        }}
      >
        {pending
          ? "Asking…"
          : waiting
            ? "Re-checking…"
            : armed
              ? "Your unsaved edits will be lost — re-check anyway?"
              : "⟳ Re-check this script"}
      </button>
      {armed && (
        <button
          type="button"
          className="btn ghost"
          style={{ marginLeft: 8 }}
          onClick={() => setArmed(false)}
        >
          Keep editing
        </button>
      )}
      {waiting && (
        <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5, color: "var(--soft)" }}>
          Reading the script as it now stands, hook included. This page updates itself when the
          answer lands — about a minute.
        </div>
      )}
      {slow && (
        <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5, color: "var(--soft)" }}>
          Still nothing after three minutes. The run may have failed — reload the page, and if the
          report below is unchanged, check the Claude Scripting executions.
        </div>
      )}
      {said && !waiting && !slow && (
        <div
          style={{
            fontSize: 12,
            marginTop: 8,
            lineHeight: 1.5,
            color: said.ok ? "var(--soft)" : "var(--red)",
          }}
        >
          {said.message}
        </div>
      )}
    </div>
  );
}
