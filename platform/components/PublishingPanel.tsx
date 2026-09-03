"use client";

import { useEffect, useState, useTransition } from "react";
import { savePublishing, type ActionResult } from "@/app/actions";
import type { Publishing } from "@/lib/data";

/**
 * The film's life AFTER the pipeline: where it stands (in review / ready to
 * post / posted), the title it will wear on YouTube, free notes, and the link
 * once it is up. Rendered only under a finished film — before that, the
 * pipeline's own gates are the state that matters.
 *
 * The state also surfaces as the card badge in the library (ProjectsGrid
 * swaps "Finished" for "Ready to post"/"Posted"), which is where this earns
 * its keep: the library answers "what is left to post" at a glance.
 *
 * The draft lives in sessionStorage because the page re-renders itself every
 * 10 seconds — a note typed into plain state would be thrown away mid-word.
 * Read after mount, never in the initializer, or the server render and the
 * hydration disagree. The draft is dropped on save and whenever it matches
 * the stored value, so a stale draft cannot shadow an edit made elsewhere.
 */

/** YouTube truncates titles at 100 characters; the counter warns past it. */
const YT_TITLE_LIMIT = 100;

const STATES: Array<{ key: Publishing["state"]; label: string }> = [
  { key: "review", label: "In review" },
  { key: "ready", label: "Ready to post" },
  { key: "posted", label: "Posted" },
];

const draftKey = (id: string) => `vf-pub:${id}`;

export default function PublishingPanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial: Publishing;
}) {
  const [pub, setPub] = useState<Publishing>(initial);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey(projectId));
      if (raw) setPub({ ...initial, ...JSON.parse(raw) });
    } catch {}
    // Server value only seeds; the draft owns the fields while it exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const dirty =
    pub.state !== initial.state ||
    pub.ytTitle !== initial.ytTitle ||
    pub.notes !== initial.notes ||
    pub.ytUrl !== initial.ytUrl;

  const set = (patch: Partial<Publishing>) => {
    const next = { ...pub, ...patch };
    setPub(next);
    setMsg(null);
    try {
      sessionStorage.setItem(draftKey(projectId), JSON.stringify(next));
    } catch {}
  };

  const save = () =>
    startTransition(async () => {
      const r = await savePublishing(projectId, pub);
      setMsg(r);
      if (r.ok) {
        try {
          sessionStorage.removeItem(draftKey(projectId));
        } catch {}
      }
    });

  const over = pub.ytTitle.length > YT_TITLE_LIMIT;

  return (
    <div className="card pubpanel" style={{ marginTop: 12 }}>
      <h5>Publishing</h5>
      <div className="kv" style={{ alignItems: "center" }}>
        <span>
          Status
          <span style={{ display: "block", fontSize: 11.5, color: "var(--dim)" }}>
            where this film stands on its way to YouTube
          </span>
        </span>
        <div className="seg" role="group" aria-label="Publishing status">
          {STATES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={pub.state === s.key ? "on" : ""}
              disabled={pending}
              onClick={() => set({ state: s.key })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <label className="pubfield">
        <span className="pubhead">
          <span>YouTube title</span>
          <span className={`pubcount${over ? " over" : ""}`}>
            {pub.ytTitle.length}/{YT_TITLE_LIMIT}
          </span>
        </span>
        <input
          type="text"
          value={pub.ytTitle}
          maxLength={200}
          placeholder="The title this film will be uploaded under"
          onChange={(e) => set({ ytTitle: e.target.value })}
        />
        {over && (
          <span className="pubwarn">
            YouTube cuts titles at {YT_TITLE_LIMIT} characters — the rest will
            not be shown.
          </span>
        )}
      </label>

      <label className="pubfield">
        <span className="pubhead">
          <span>Notes</span>
        </span>
        <textarea
          value={pub.notes}
          rows={3}
          maxLength={4000}
          placeholder="Anything to remember — what to fix, when to post, description ideas…"
          onChange={(e) => set({ notes: e.target.value })}
        />
      </label>

      {pub.state === "posted" && (
        <label className="pubfield">
          <span className="pubhead">
            <span>YouTube link</span>
          </span>
          <input
            type="url"
            value={pub.ytUrl}
            maxLength={500}
            placeholder="https://youtube.com/watch?v=…"
            onChange={(e) => set({ ytUrl: e.target.value })}
          />
        </label>
      )}
      {/* Kept even while state is not "posted": a saved link should stay
          reachable if the state is flipped back for a re-edit. */}
      {pub.state !== "posted" && pub.ytUrl && (
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 0" }}>
          Saved link: <a href={pub.ytUrl} target="_blank" rel="noreferrer">{pub.ytUrl}</a>
        </p>
      )}

      {msg && (
        <p className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 8 }}>
          {msg.message}
        </p>
      )}
      {dirty && (
        <button
          className="abtn ok"
          style={{ width: "100%", marginTop: 10 }}
          disabled={pending}
          onClick={save}
        >
          {pending ? "Saving…" : "Save publishing info"}
        </button>
      )}
    </div>
  );
}
