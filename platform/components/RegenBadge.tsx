"use client";

import { useEffect, useState } from "react";

/**
 * The "a regeneration is in flight" state, shown in place of the
 * Approve/Regenerate buttons.
 *
 * Every regeneration path works the same way: the site sets a flag in
 * Airtable, an n8n loop picks it up within ~15s and clears it when the new
 * asset lands OR when the request is rejected. So a set flag means "in
 * flight", and the flag clearing is what brings the buttons back — including
 * after a failure, with the reason shown underneath.
 *
 * WHY IT ALSO SAYS HOW LONG, AND WHETHER ANYTHING IS RUNNING (2026-09-17).
 *
 * That paragraph above is true of the flag and was false of the screen. A
 * video regeneration has no webhook of its own: the flag is noticed only by
 * `Evaluate Video Approval`, polling every 15s from inside a batch that has
 * already walked the whole film, and the Veo generation that follows writes
 * nothing to the database until it finishes. So this badge read exactly the
 * same in second one and in minute forty, whether a batch was working on it
 * or nothing was running at all.
 *
 * The producer could not tell those apart, and the site's own advice for a
 * screen that looks stuck was "use Pause first, then Resume" — while Pause
 * stops the execution and throws the in-flight generation away, and Resume
 * restarts the pass from the top. Do that once and the regeneration is lost;
 * do it every time the badge looks stuck — which was always, because it could
 * not look like anything else — and a regeneration can never finish. That is
 * the whole of "regen does nothing, and it has always been like this"
 * (`db/port/regen-unstick/README.md`).
 *
 * So the badge now answers the only question a producer actually has: is
 * anything working on this, and how long have I been waiting? Nothing here
 * decides or writes — it reports, and the buttons beside it stay the way out.
 */
export default function RegenBadge({
  label = "Regenerating…",
  note,
  since = null,
  alive = null,
}: {
  label?: string;
  note?: string | null;
  /** When the flag was set (ISO). null = unknown; the age is then not shown. */
  since?: string | null;
  /**
   * Is a media-generation batch alive in n8n right now?
   * `null` = the n8n API did not answer, which is NOT the same as "nothing is
   * running" and must not be reported as it.
   */
  alive?: boolean | null;
}) {
  // n8n writes rejections into the same notes field the reviewer writes
  // feedback into; only the rejection half is worth surfacing here.
  const rejection =
    note && /REJECTED|failed|error/i.test(note) ? note.replace(/\s+/g, " ").trim() : null;

  // AFTER MOUNT, never in the initial render: the server and the client would
  // compute a different "now" and React would report a hydration mismatch on
  // every badge. The first paint shows the label alone, which is what the
  // badge has always shown, and the age appears a tick later.
  const [waited, setWaited] = useState<string | null>(null);
  useEffect(() => {
    if (!since) return;
    const started = new Date(since).getTime();
    if (!Number.isFinite(started)) return;
    const tick = () => {
      const mins = Math.max(0, Math.round((Date.now() - started) / 60000));
      setWaited(mins < 1 ? "just now" : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [since]);

  return (
    <div style={{ marginTop: 12 }}>
      <span
        className="chip run"
        style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
      >
        <span className="regenspin" aria-hidden />
        {label}
        {waited && <span style={{ opacity: 0.75 }}>· {waited}</span>}
      </span>
      {alive === true && (
        <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dim)" }}>
          Production is running — leave it. Pausing now throws this generation
          away and the next run has to cross the whole film again before it can
          pick the request back up.
        </p>
      )}
      {alive === false && (
        <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dim)" }}>
          Nothing is running in n8n, so this is not moving on its own — a
          regeneration is only ever picked up by a live production run. Use “⟳
          Send it again” below to start one.
        </p>
      )}
      {rejection && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--red)",
          }}
        >
          Last attempt failed: {rejection.slice(0, 260)}
        </p>
      )}
      <style>{`
        .regenspin {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          border: 1.5px solid currentColor;
          border-top-color: transparent;
          animation: regenspin 0.7s linear infinite;
        }
        @keyframes regenspin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .regenspin { animation: none; opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
