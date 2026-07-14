"use client";

import { useState, useTransition } from "react";
import { approveScript, saveScript, type ActionResult } from "@/app/actions";

/**
 * Editable script review. The text keeps its [CHAPTER n: title] markers —
 * the scripting workflow re-parses chapters from exactly this text after
 * approval, so edits flow straight into production.
 */
export default function ScriptReview({
  projectId,
  scriptId,
  content,
}: {
  projectId: string;
  scriptId: string;
  content: string;
}) {
  const [text, setText] = useState(content);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = text !== content;

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setMsg(await fn()));

  return (
    <div className="script">
      <div className="sechead">
        <h2>Script review</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn"
            disabled={pending || !dirty}
            onClick={() => run(() => saveScript(projectId, scriptId, text))}
          >
            {pending ? "…" : "Save draft"}
          </button>
          <button
            className="btn gold"
            disabled={pending}
            onClick={() => run(() => approveScript(projectId, scriptId, text))}
          >
            {pending ? "Approving…" : "Approve script"}
          </button>
        </div>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--soft)" }}>
        Poți edita textul direct aici — păstrează marcajele{" "}
        <code style={{ color: "var(--amber)" }}>[CHAPTER n: titlu]</code>, ele
        despart capitolele. Approve trimite exact ce vezi mai jos în producție.
      </p>
      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
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
        {text.trim().split(/\s+/).filter(Boolean).length} cuvinte
        {dirty ? " · modificat" : ""}
      </div>
    </div>
  );
}
