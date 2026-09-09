"use client";

/**
 * "Upload footage" — a producer's own file into the library, with exactly
 * what they declare about it and nothing more.
 *
 * Rights are their statement; "I don't know" is the default and means manual
 * review. Provenance is not asked here at all: an upload is `unknown` until a
 * person says what it shows, from the admin page or the scene's Footage type
 * control — never authentic by upload.
 */

import { useRef, useState } from "react";
import styles from "./FootageForms.module.css";

export default function FootageUpload({
  onSaved,
  onClose,
}: {
  onSaved?: (id: string, title: string) => void;
  onClose?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) {
      setErr("Pick a file first.");
      return;
    }
    setBusy(true);
    setErr(null);
    setDone(null);
    // XHR rather than fetch, for the one thing fetch cannot do: report the
    // upload's progress. A 400 MB reel with no bar reads as a hang.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/footage/upload");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      setBusy(false);
      setProgress(null);
      try {
        const body = JSON.parse(xhr.responseText) as { ok: boolean; error?: string; asset?: { id: string; title: string } };
        if (xhr.status >= 400 || !body.ok) throw new Error(body.error ?? `HTTP ${xhr.status}`);
        setDone(body.asset?.title ?? "Uploaded");
        onSaved?.(body.asset!.id, body.asset!.title);
        form.reset();
      } catch (er) {
        setErr((er as Error).message);
      }
    };
    xhr.onerror = () => {
      setBusy(false);
      setProgress(null);
      setErr("The upload failed — the connection dropped.");
    };
    xhr.send(data);
  };

  return (
    <form ref={formRef} className={styles.wrap} onSubmit={submit}>
      <div className={styles.head}>
        <h6>Upload footage</h6>
        {onClose && (
          <button type="button" className="abtn" onClick={onClose} disabled={busy}>
            Close
          </button>
        )}
      </div>
      <p className={styles.hint}>
        A video (mp4, webm, mov) or a photo (jpg, png, webp), up to 800 MB. It is filed with what you say about it
        — and only that. Its provenance stays <b>unverified</b> until someone states what it shows.
      </p>
      <label>
        File
        <input className={styles.input} type="file" name="file" accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp" disabled={busy} />
      </label>
      <label>
        Title
        <input className={styles.input} name="title" placeholder="What is it, in a few words" disabled={busy} />
      </label>
      <label>
        Description (optional)
        <textarea className={styles.input} name="description" rows={2} disabled={busy} />
      </label>
      <div className={styles.two}>
        <label>
          Event (optional)
          <input className={styles.input} name="eventName" disabled={busy} />
        </label>
        <label>
          When shot (optional)
          <input className={styles.input} name="filmingDate" placeholder="e.g. 8 Sep 2026" disabled={busy} />
        </label>
      </div>
      <div className={styles.two}>
        <label>
          Where (optional)
          <input className={styles.input} name="location" disabled={busy} />
        </label>
        <label>
          Country (optional)
          <input className={styles.input} name="country" disabled={busy} />
        </label>
      </div>
      <label>
        Owner / source (optional)
        <input className={styles.input} name="owner" placeholder="Who filmed it, or where it came from" disabled={busy} />
      </label>
      <div className={styles.two}>
        <label>
          Rights
          <select className={styles.input} name="rights" defaultValue="manual_review" disabled={busy}>
            <option value="manual_review">I don&rsquo;t know yet — manual review</option>
            <option value="cleared">Cleared — free to use</option>
            <option value="attribution_required">Free to use with a credit</option>
            <option value="restricted">Restricted — do not render</option>
          </select>
        </label>
        <label>
          Credit line (optional)
          <input className={styles.input} name="attribution" disabled={busy} />
        </label>
      </div>
      <label>
        Notes (optional)
        <textarea className={styles.input} name="notes" rows={2} disabled={busy} />
      </label>
      {err && <p className={`${styles.status} ${styles.err}`}>{err}</p>}
      {done && <p className={`${styles.status} ${styles.ok}`}>Filed: {done}</p>}
      <div className={styles.row}>
        <button type="submit" className="abtn ok" disabled={busy}>
          {busy ? (progress !== null ? `Uploading ${progress}%` : "Uploading…") : "Upload"}
        </button>
      </div>
    </form>
  );
}
