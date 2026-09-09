"use client";

/**
 * "Add footage from URL" — paste an address, see what the page actually
 * states, then decide whether to file it.
 *
 * Two steps on purpose. The importer reads OpenGraph, JSON-LD and the video
 * tags, or hands a known provider's page to that provider's API; what it
 * could NOT establish is listed as warnings, and when rights could not be
 * established the preview says MANUAL REVIEW in as many words. Nothing is
 * saved until the person has seen that and pressed Save — and a manual-review
 * asset saved from here is not renderable until they, or the admin page,
 * verifies it.
 *
 * What it refuses is decided on the server (lib/footage/urlImport.ts): no
 * DRM, no paywalls, no logins, no platform streams.
 */

import { useState } from "react";
import ArchiveCard, { type CardAsset } from "./ArchiveCard";
import styles from "./FootageForms.module.css";

interface Preview {
  via: "provider" | "page";
  asset: Record<string, unknown> & {
    title: string;
    mediaType: "video" | "image";
    thumbnailUrl: string | null;
    sourceUrl: string;
    downloadUrl: string;
    creator: string | null;
    licenseOriginal: string | null;
    reviewStatus: "auto_approved" | "manual_review" | "rejected";
    reviewReason: string | null;
    attributionRequired: boolean;
    durationSeconds: number | null;
    dateOriginal: string | null;
    yearsMentioned: number[];
    width: number | null;
    height: number | null;
    provider: string;
    filmingDate?: string | null;
    location?: string | null;
    eventName?: string | null;
    description?: string | null;
  };
  rights: { status: string; reason?: string; attribution?: string };
  warnings: string[];
}

export default function FootageImport({
  onSaved,
  onClose,
}: {
  /** The saved library row's id — the picker offers "Use" on it. */
  onSaved?: (id: string, title: string) => void;
  onClose?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [title, setTitle] = useState("");
  const [eventName, setEventName] = useState("");
  const [location, setLocation] = useState("");
  const [filmingDate, setFilmingDate] = useState("");
  const [rights, setRights] = useState<"" | "cleared" | "attribution_required" | "manual_review">("");
  const [attribution, setAttribution] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const run = async (confirm: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/footage/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          confirm
            ? {
                url,
                confirm: true,
                title: title || undefined,
                eventName: eventName || undefined,
                location: location || undefined,
                filmingDate: filmingDate || undefined,
                rights: rights || undefined,
                attribution: attribution || undefined,
              }
            : { url },
        ),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; saved?: boolean; asset?: Preview["asset"] & { id?: string } } & Partial<Preview>;
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (confirm) {
        const id = String(body.asset?.id ?? "");
        setSaved(id);
        onSaved?.(id, String(body.asset?.title ?? title));
      } else {
        setPreview({ via: body.via ?? "page", asset: body.asset!, rights: body.rights!, warnings: body.warnings ?? [] });
        setTitle(body.asset?.title ?? "");
        setEventName(body.asset?.eventName ?? "");
        setLocation(body.asset?.location ?? "");
        setFilmingDate(body.asset?.filmingDate ?? "");
        setRights("");
        setAttribution("");
        setSaved(null);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const a = preview?.asset;
  const card: CardAsset | null = a
    ? {
        title: a.title,
        mediaType: a.mediaType,
        thumbnailUrl: a.thumbnailUrl,
        sourceUrl: a.sourceUrl,
        creator: a.creator,
        license: a.licenseOriginal,
        reviewStatus: a.reviewStatus,
        reviewReason: a.reviewReason,
        attributionRequired: a.attributionRequired,
        durationSeconds: a.durationSeconds,
        dateOriginal: a.dateOriginal,
        yearsMentioned: a.yearsMentioned,
        width: a.width,
        height: a.height,
        provider: a.provider,
        usage: preview?.rights.status,
        usageReason: preview?.rights.reason ?? null,
        filmingDate: a.filmingDate ?? null,
        location: a.location ?? null,
        provenance: "unknown",
      }
    : null;
  const noFile = a ? a.downloadUrl === a.sourceUrl : false;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h6>Add footage from URL</h6>
        {onClose && (
          <button type="button" className="abtn" onClick={onClose} disabled={busy}>
            Close
          </button>
        )}
      </div>
      <p className={styles.hint}>
        Paste the page of a video or a photo — a government media site, an agency, an archive. The page&rsquo;s own
        metadata is read; nothing behind a login, a paywall or a platform&rsquo;s protection is taken.
      </p>
      <div className={styles.row}>
        <input
          className={styles.input}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (url.trim()) void run(false);
            }
          }}
        />
        <button type="button" className="abtn ok" disabled={busy || !url.trim()} onClick={() => void run(false)}>
          {busy && !preview ? "Reading…" : "Import"}
        </button>
      </div>
      {err && <p className={`${styles.status} ${styles.err}`}>{err}</p>}

      {preview && card && (
        <div className={styles.preview}>
          <div className={styles.previewCard}>
            <ArchiveCard asset={card} />
          </div>
          <div className={styles.previewForm}>
            <p className={`${styles.rights} ${preview.rights.status === "cleared" || preview.rights.status === "attribution_required" ? styles.rightsOk : styles.rightsWarn}`}>
              Rights status: <b>{preview.rights.status.replace("_", " ")}</b>
              {preview.rights.reason ? ` — ${preview.rights.reason}` : ""}
            </p>
            {preview.warnings.map((w) => (
              <p key={w} className={styles.warn}>
                {w}
              </p>
            ))}
            {noFile && <p className={styles.warn}>No media file was found on the page — it can be filed for reference, but a scene cannot use it.</p>}
            <label>
              Title
              <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </label>
            <label>
              Event (optional)
              <input className={styles.input} value={eventName} onChange={(e) => setEventName(e.target.value)} disabled={busy} />
            </label>
            <div className={styles.two}>
              <label>
                Where (optional)
                <input className={styles.input} value={location} onChange={(e) => setLocation(e.target.value)} disabled={busy} />
              </label>
              <label>
                When shot (optional)
                <input className={styles.input} value={filmingDate} onChange={(e) => setFilmingDate(e.target.value)} disabled={busy} />
              </label>
            </div>
            {preview.rights.status !== "cleared" && preview.rights.status !== "attribution_required" && a?.reviewStatus !== "rejected" && (
              <label>
                I have established the rights
                <select className={styles.input} value={rights} onChange={(e) => setRights(e.target.value as typeof rights)} disabled={busy}>
                  <option value="">Not yet — keep it under manual review</option>
                  <option value="cleared">Cleared — free to use</option>
                  <option value="attribution_required">Free to use with a credit</option>
                </select>
              </label>
            )}
            {(rights === "attribution_required" || preview.rights.status === "attribution_required") && (
              <label>
                Credit line
                <input className={styles.input} value={attribution} onChange={(e) => setAttribution(e.target.value)} placeholder={preview.rights.attribution ?? ""} disabled={busy} />
              </label>
            )}
            <div className={styles.row}>
              <button type="button" className="abtn ok" disabled={busy || Boolean(saved)} onClick={() => void run(true)}>
                {saved ? "Saved to the library" : busy ? "Saving…" : "Save to the library"}
              </button>
              <a href={a?.sourceUrl} target="_blank" rel="noreferrer">
                open source ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
