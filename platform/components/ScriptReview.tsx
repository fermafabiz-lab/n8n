"use client";

import { useEffect, useState, useTransition } from "react";
import { approveScript, regenerateScript, saveScript, type ActionResult } from "@/app/actions";
import RegenBadge from "@/components/RegenBadge";

/**
 * Editable script review. The text keeps its [CHAPTER n: title] markers —
 * the scripting workflow re-parses chapters from exactly this text after
 * approval, so edits flow straight into production.
 *
 * The draft lives in sessionStorage, not only in React state: the page
 * auto-refreshes every 10s, and a remount of this component (stage flicker,
 * data hiccup) used to silently reset the textarea to the server's version —
 * the user then approved what LOOKED like their edit but wasn't (seen in
 * production: scenes generated from the unedited script).
 */
export default function ScriptReview({
  projectId,
  scriptId,
  content,
  regenerating = false,
  locked = false,
}: {
  projectId: string;
  scriptId: string;
  content: string;
  /** The workflow is rewriting this draft right now (Airtable Status =
   *  'rejected'); it flips back to 'awaiting_approval' with the new text. */
  regenerating?: boolean;
  /**
   * Already approved (Airtable Status = 'approved'), so this panel becomes a
   * read-only record rather than a gate. Everything downstream — chapters,
   * scenes, narration, image prompts — was derived from this exact text, so
   * changing it here would describe a film that no longer exists.
   */
  locked?: boolean;
}) {
  const draftKey = `vf-script-draft:${scriptId}`;
  const [text, setText] = useState(content);
  const [feedback, setFeedback] = useState("");
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = text !== content;

  // Restore a surviving draft after any remount; keep it saved while typing.
  // Once approved the draft is DROPPED instead: an edit typed before approval
  // and never saved would otherwise reappear on top of the approved text and
  // read as the script production is running on, which it is not.
  useEffect(() => {
    try {
      if (locked) {
        sessionStorage.removeItem(draftKey);
        return;
      }
      const saved = sessionStorage.getItem(draftKey);
      if (saved !== null && saved !== content) setText(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, locked]);
  const update = (v: string) => {
    setText(v);
    try {
      if (v === content) sessionStorage.removeItem(draftKey);
      else sessionStorage.setItem(draftKey, v);
    } catch {}
  };
  const clearDraft = () => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {}
  };

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setMsg(await fn()));

  // Signed off: a record of what production was built from, nothing more.
  // The text is rendered rather than put in a textarea so the whole script is
  // on the page — clicking the Script step is how you go back and READ it,
  // and a fixed-height box with its own scrollbar fights exactly that.
  if (locked) {
    return (
      <div className="script">
        <div className="sechead">
          <h2>Script</h2>
          <span className="chip ok">Approved</span>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
          This is the text the film was built from — the chapters, scenes,
          narration and image prompts all come from it, so it is kept exactly
          as approved. Individual scenes can still be reopened and rewritten
          from the Scenes step; rewriting the script itself would mean
          producing the film again from the top.
        </p>
        <div
          style={{
            width: "100%",
            background: "var(--bg2)",
            border: "1px solid var(--line2)",
            borderRadius: 12,
            color: "var(--ink)",
            fontSize: 14.5,
            lineHeight: 1.7,
            padding: "16px 18px",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {content}
        </div>
        <div
          style={{ marginTop: 8, fontSize: 12, color: "var(--dim)", textAlign: "right" }}
        >
          {content.trim().split(/\s+/).filter(Boolean).length} words
        </div>
      </div>
    );
  }

  return (
    <div className="script">
      <div className="sechead">
        <h2>Script review</h2>
        {regenerating ? (
          <RegenBadge label="Rewriting script…" />
        ) : (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn"
            disabled={pending || !dirty}
            onClick={() =>
              run(async () => {
                const r = await saveScript(projectId, scriptId, text);
                if (r.ok) clearDraft();
                return r;
              })
            }
          >
            {pending ? "…" : "Save draft"}
          </button>
          <button
            className="btn gold"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await approveScript(projectId, scriptId, text);
                if (r.ok) clearDraft();
                return r;
              })
            }
          >
            {pending ? "Approving…" : "Approve script"}
          </button>
        </div>
        )}
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
        You can edit the text right here — keep the{" "}
        <code style={{ color: "var(--accent)" }}>[CHAPTER n: title]</code>{" "}
        markers, they separate the chapters. Approve sends exactly what you see
        below into production.
      </p>
      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}
      <textarea
        value={text}
        onChange={(e) => update(e.target.value)}
        spellCheck={false}
        readOnly={regenerating}
        style={{
          width: "100%",
          minHeight: 420,
          background: "var(--bg2)",
          border: "1px solid var(--line2)",
          borderRadius: 12,
          color: "var(--ink)",
          font: "inherit",
          fontSize: 14.5,
          lineHeight: 1.7,
          padding: "16px 18px",
          resize: "vertical",
          outline: "none",
        }}
      />
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--dim)", textAlign: "right" }}>
        {text.trim().split(/\s+/).filter(Boolean).length} words
        {dirty ? " · edited" : ""}
      </div>

      {!regenerating && (
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--soft)" }}>
          Not happy with the whole draft? Describe what should change and the
          AI rewrites it from scratch — small fixes are faster done by editing
          the text above.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. “less flowery language, more concrete dates and events, stronger ending”"
            rows={2}
            style={{
              flex: 1,
              background: "var(--bg2)",
              border: "1px solid var(--line2)",
              borderRadius: 10,
              color: "var(--ink)",
              font: "inherit",
              fontSize: 13,
              padding: "10px 12px",
              resize: "vertical",
              outline: "none",
            }}
          />
          <button
            className="btn"
            disabled={pending}
            onClick={() => run(() => regenerateScript(projectId, scriptId, feedback))}
          >
            {pending ? "…" : "↻ Regenerate script"}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
