"use client";

import { useEffect, useState, useTransition } from "react";
import { savePublishing, type ActionResult } from "@/app/actions";
import type { Publishing } from "@/lib/data";
import styles from "./PublishingPanel.module.css";

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
/** …and descriptions at 5000. */
const YT_DESC_LIMIT = 5000;

const STATES: Array<{ key: Publishing["state"]; label: string }> = [
  { key: "review", label: "In review" },
  { key: "ready", label: "Ready to post" },
  { key: "posted", label: "Posted" },
];

const draftKey = (id: string) => `vf-pub:${id}`;

export default function PublishingPanel({
  projectId,
  initial,
  stills = [],
}: {
  projectId: string;
  initial: Publishing;
  /** Scene stills, in film order — the thumbnail candidates. Every one was
   *  already generated and approved; picking a YouTube thumbnail from them
   *  costs nothing and needs no new generation. */
  stills?: Array<{ label: string; url: string }>;
}) {
  const [pub, setPub] = useState<Publishing>(initial);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState<"title" | "desc" | null>(null);
  const [showThumbs, setShowThumbs] = useState(false);

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
    pub.description !== initial.description ||
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
  const descOver = pub.description.length > YT_DESC_LIMIT;

  /**
   * Ask /api/yt-kit for the derived description — the film's own opening
   * narration, its chapter markers with timestamps summed from the real
   * takes, and the research pack's sources. Fills the draft; nothing is
   * stored until Save, so a bad generation costs one click to discard.
   */
  const generate = async () => {
    setBuilding(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/yt-kit?project=${projectId}`, { cache: "no-store" });
      const body = (await res.json()) as {
        description?: string;
        measured?: boolean;
        chapters?: number;
        sources?: number;
        error?: string;
      };
      if (!res.ok || !body.description) {
        setMsg({ ok: false, message: body.error ?? "Could not build the description." });
        return;
      }
      set({ description: body.description.slice(0, YT_DESC_LIMIT + 500) });
      const bits = [
        `${body.chapters ?? 0} chapters${body.measured ? "" : " (timestamps estimated)"}`,
        `${body.sources ?? 0} sources`,
      ];
      setMsg({ ok: true, message: `Description built — ${bits.join(", ")}. Edit freely, then save.` });
    } catch {
      setMsg({ ok: false, message: "Could not build the description." });
    } finally {
      setBuilding(false);
    }
  };

  const copy = async (which: "title" | "desc") => {
    try {
      await navigator.clipboard.writeText(which === "title" ? pub.ytTitle : pub.description);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setMsg({ ok: false, message: "Clipboard unavailable — select and copy by hand." });
    }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
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

      <label className={styles.field}>
        <span className={styles.head}>
          <span>YouTube title</span>
          <span className={styles.tools}>
            {pub.ytTitle && (
              <button type="button" className={styles.copybtn} onClick={() => copy("title")}>
                {copied === "title" ? "✓ Copied" : "⧉ Copy"}
              </button>
            )}
            <span className={`${styles.count}${over ? ` ${styles.over}` : ""}`}>
              {pub.ytTitle.length}/{YT_TITLE_LIMIT}
            </span>
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
          <span className={styles.warn}>
            YouTube cuts titles at {YT_TITLE_LIMIT} characters — the rest will
            not be shown.
          </span>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.head}>
          <span>YouTube description</span>
          <span className={styles.tools}>
            <button type="button" className={styles.copybtn} disabled={building} onClick={generate}>
              {building ? "Building…" : "⚙ Build from the film"}
            </button>
            {pub.description && (
              <button type="button" className={styles.copybtn} onClick={() => copy("desc")}>
                {copied === "desc" ? "✓ Copied" : "⧉ Copy"}
              </button>
            )}
            <span className={`${styles.count}${descOver ? ` ${styles.over}` : ""}`}>
              {pub.description.length}/{YT_DESC_LIMIT}
            </span>
          </span>
        </span>
        <textarea
          value={pub.description}
          rows={pub.description ? 8 : 3}
          maxLength={YT_DESC_LIMIT + 500}
          placeholder="Build it from the film — opening line, chapter timestamps, the research sources — then edit freely."
          onChange={(e) => set({ description: e.target.value })}
        />
        {descOver && (
          <span className={styles.warn}>
            YouTube cuts descriptions at {YT_DESC_LIMIT} characters.
          </span>
        )}
      </label>

      {stills.length > 0 && (
        <div className={styles.field}>
          <span className={styles.head}>
            <span>Thumbnail</span>
            <button
              type="button"
              className={styles.copybtn}
              onClick={() => setShowThumbs((v) => !v)}
            >
              {showThumbs ? "Hide stills" : `Pick from ${stills.length} stills`}
            </button>
          </span>
          {showThumbs && (
            <>
              <div className={styles.thumbs}>
                {stills.map((s) => (
                  <a
                    key={s.label}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    download={`thumbnail-${s.label}.jpg`}
                    title={`${s.label} — open full size / download`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt={`Scene ${s.label} still`} loading="lazy" />
                    <span>{s.label}</span>
                  </a>
                ))}
              </div>
              <span className={styles.hint}>
                Every still is the full-resolution image its scene was generated
                from — click one to open or save it, then upload it as the
                thumbnail on YouTube.
              </span>
            </>
          )}
        </div>
      )}

      <label className={styles.field}>
        <span className={styles.head}>
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
        <label className={styles.field}>
          <span className={styles.head}>
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
