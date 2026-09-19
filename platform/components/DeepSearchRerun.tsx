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
 * It does not block anything either. The script gate stays open, the Approve
 * button is untouched, and the re-run changes no words — it replaces the
 * report and nothing else.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rerunDeepSearch, type ActionResult } from "@/app/actions";

export default function DeepSearchRerun({ projectId }: { projectId: string }) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="btn ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await rerunDeepSearch(projectId);
            setSaid(r);
            // The webhook answers `onReceived`, so the report is NOT written
            // yet — refreshing now would redraw the same numbers and read as
            // "the button did nothing". The message says to reload; this
            // refresh is only so a `not-documentary` or misconfigured answer
            // lands on a page that agrees with it.
            if (!r.ok) router.refresh();
          })
        }
      >
        {pending ? "Asking…" : "⟳ Re-check this script"}
      </button>
      {said && (
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
