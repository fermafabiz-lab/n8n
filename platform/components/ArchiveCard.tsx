"use client";

/**
 * One real-footage asset, as a card — shared by the scene picker, the AI
 * suggestions bar and the admin page, so a licence, a provider and a
 * provenance read the same wherever they appear.
 *
 * What it shows is chosen for the decision being made: the licence verdict
 * as a coloured chip WITH its reason (a share-alike obligation is an
 * obligation), the provider it came through, the engine's score and the
 * provenance it would carry for THIS scene when the caller has those, the
 * provider's date string exactly as given and labelled "dated" (it lies —
 * see NormalizedArchiveAsset.dateOriginal), and the years the description
 * mentions. The action row is the caller's.
 */

import type { ReactNode } from "react";
import { providerLabel } from "@/lib/provenance";
import styles from "./ArchiveCard.module.css";

export interface CardAsset {
  title: string;
  mediaType: "video" | "image";
  thumbnailUrl: string | null;
  sourceUrl: string;
  creator: string | null;
  /** The licence as the provider states it. */
  license: string | null;
  reviewStatus: "auto_approved" | "manual_review" | "rejected";
  reviewReason?: string | null;
  /** Share-alike shows on the chip; absent when the caller does not know. */
  shareAlike?: boolean;
  attributionRequired?: boolean;
  durationSeconds: number | null;
  dateOriginal: string | null;
  yearsMentioned: number[];
  width?: number | null;
  height?: number | null;
  /** Universal engine enrichments — all optional; a caller that has none renders the classic card. */
  provider?: string | null;
  score?: number | null;
  provenance?: string | null;
  usage?: string | null;
  usageReason?: string | null;
  filmingDate?: string | null;
  location?: string | null;
  eventName?: string | null;
  footageFormat?: string | null;
}

export function licenceChip(a: CardAsset): { cls: "ok" | "warn" | "bad"; text: string; title: string } {
  const lic = a.license ?? "licence unknown";
  if (a.reviewStatus === "rejected" || a.usage === "restricted")
    return { cls: "bad", text: `✕ ${lic}`, title: a.usageReason ?? a.reviewReason ?? "Licence forbids this use" };
  if (a.usage === "editorial_only")
    return { cls: "warn", text: `? editorial only`, title: a.usageReason ?? "Editorial use only — confirm before rendering" };
  if (a.reviewStatus === "manual_review" || a.usage === "manual_review" || a.usage === "unknown")
    return { cls: "warn", text: `? ${lic}`, title: a.usageReason ?? a.reviewReason ?? "Check the licence before use" };
  const sa = a.shareAlike ? " · share-alike" : "";
  const credit = a.attributionRequired || a.usage === "attribution_required" ? " · credit" : "";
  return { cls: "ok", text: `✓ ${lic}${sa}${credit}`, title: "Auto-approved by the licence rules" };
}

const PROVENANCE_SHORT: Record<string, string> = {
  actual_footage: "ACTUAL",
  illustrative_footage: "ILLUSTRATIVE",
  archival_footage: "ARCHIVAL",
  archival_photo: "ARCHIVAL PHOTO",
  real_stock: "REAL",
  unknown: "UNVERIFIED",
};

/**
 * The one-line credit under the title: who made it, where and when the
 * PROVIDER says it was shot (its own filming date, which official media
 * record deliberately), how big it is, and both catalogue dates — the
 * provider's own string, labelled "dated" because it is often the upload
 * rather than the event, and the years the description MENTIONS.
 */
function metaLine(a: CardAsset): string {
  return [
    a.creator,
    a.location,
    a.filmingDate ? `shot ${a.filmingDate}` : null,
    a.width && a.height ? `${a.width}×${a.height}` : null,
    !a.filmingDate && a.dateOriginal ? `dated ${a.dateOriginal}` : null,
    a.yearsMentioned.length ? `mentions ${a.yearsMentioned.slice(0, 3).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const fmtDuration = (s: number | null): string | null => {
  if (s === null) return null;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
};

export default function ArchiveCard({
  asset,
  selected = false,
  onSelect,
  children,
}: {
  asset: CardAsset;
  selected?: boolean;
  onSelect?: () => void;
  /** The action row — options and buttons — rendered under the metadata. */
  children?: ReactNode;
}) {
  const chip = licenceChip(asset);
  const kind = asset.footageFormat && asset.footageFormat !== "unknown" && asset.footageFormat !== "broll" ? asset.footageFormat.replace("_", " ") : asset.mediaType === "video" ? "video" : "photo";
  // No `style` escape hatch: the card fills whatever grid track it is dropped
  // into, and both callers use the same track size on purpose.
  return (
    <div className={`${styles.card}${selected ? ` ${styles.sel}` : ""}`} onClick={onSelect}>
      <div className={styles.thumb}>
        {asset.thumbnailUrl ? (
          // Served straight from the archive: a result is a preview, and
          // only the chosen one is ever copied here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnailUrl} alt="" loading="lazy" />
        ) : null}
        <span className={styles.kind}>{kind}</span>
        {typeof asset.score === "number" && (
          <span className={styles.score} title="The engine's relevance score for this scene, 0–100">
            {asset.score}
          </span>
        )}
        {asset.durationSeconds !== null && <span className={styles.dur}>{fmtDuration(asset.durationSeconds)}</span>}
      </div>
      <div className={styles.body}>
        <div className={styles.title} title={asset.title}>
          {asset.title}
        </div>
        {/* Joined from a filtered list rather than concatenated with its own
            separators: a suggestion carries no width/height, so the
            hand-written version printed "NASA ·  · dated 1969". */}
        <div className={styles.meta}>{metaLine(asset)}</div>
        <div className={styles.chips}>
          {asset.provider && (
            <span className={styles.prov} title="Where it came through">
              {providerLabel(asset.provider)}
            </span>
          )}
          <span className={`${styles.lic} ${styles[chip.cls]}`} title={chip.title}>
            {chip.text}
          </span>
          {asset.provenance && (
            <span
              className={`${styles.pv} ${asset.provenance === "actual_footage" ? styles.pvActual : asset.provenance === "unknown" ? styles.pvUnknown : ""}`}
              title="What the watermark would print for this scene"
            >
              {PROVENANCE_SHORT[asset.provenance] ?? asset.provenance}
            </span>
          )}
        </div>
        {(asset.reviewStatus === "manual_review" || asset.usage === "manual_review" || asset.usage === "editorial_only") &&
          (asset.usageReason ?? asset.reviewReason) && <div className={styles.meta}>{asset.usageReason ?? asset.reviewReason}</div>}
        {children}
      </div>
    </div>
  );
}

/** The option inputs both callers render — start offset (video) and length. */
export function ArchiveUseOptions({
  isVideo,
  offset,
  seconds,
  onOffset,
  onSeconds,
}: {
  isVideo: boolean;
  offset: string;
  seconds: string;
  onOffset: (v: string) => void;
  onSeconds: (v: string) => void;
}) {
  return (
    <div className={styles.opts} onClick={(e) => e.stopPropagation()}>
      {isVideo && (
        <label>
          start at
          <input type="number" min={0} step={1} value={offset} onChange={(e) => onOffset(e.target.value)} />
          s
        </label>
      )}
      <label>
        length
        <input type="number" min={3} max={20} step={1} value={seconds} onChange={(e) => onSeconds(e.target.value)} />
        s
      </label>
    </div>
  );
}

export const actionsClass = styles.actions;
