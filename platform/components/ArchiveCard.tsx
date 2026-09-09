"use client";

/**
 * One archive asset, as a card — shared by the search picker and the AI
 * suggestions bar, so the two cannot drift into two ways of showing the
 * same licence.
 *
 * What it shows is chosen for the decision being made: the licence verdict
 * as a coloured chip WITH its reason (a share-alike obligation is an
 * obligation), the provider's date string exactly as given and labelled
 * "dated" (it lies — see NormalizedArchiveAsset.dateOriginal), and the years
 * the description mentions, the nearest thing to a period the metadata
 * offers. The action row is the caller's.
 */

import type { ReactNode } from "react";
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
}

export function licenceChip(a: CardAsset): { cls: "ok" | "warn" | "bad"; text: string; title: string } {
  const lic = a.license ?? "licence unknown";
  if (a.reviewStatus === "rejected")
    return { cls: "bad", text: `✕ ${lic}`, title: a.reviewReason ?? "Licence forbids this use" };
  if (a.reviewStatus === "manual_review")
    return { cls: "warn", text: `? ${lic}`, title: a.reviewReason ?? "Check the licence before use" };
  const sa = a.shareAlike ? " · share-alike" : "";
  const credit = a.attributionRequired ? " · credit" : "";
  return { cls: "ok", text: `✓ ${lic}${sa}${credit}`, title: "Auto-approved by the licence rules" };
}

/**
 * The one-line credit under the title: who made it, how big it is, and both
 * dates — the provider's own string, labelled "dated" because it is often the
 * upload rather than the event, and the years the description MENTIONS, which
 * are the nearest thing to a period the metadata offers.
 */
function metaLine(a: CardAsset): string {
  return [
    a.creator,
    a.width && a.height ? `${a.width}×${a.height}` : null,
    a.dateOriginal ? `dated ${a.dateOriginal}` : null,
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
  // No `style` escape hatch: the card fills whatever grid track it is dropped
  // into, and both callers use the same track size on purpose. It had one, and
  // the inline `width: 200` it carried is exactly what kept the suggestions
  // from filling the room they were moved into.
  return (
    <div
      className={`${styles.card}${selected ? ` ${styles.sel}` : ""}`}
      onClick={onSelect}
    >
      <div className={styles.thumb}>
        {asset.thumbnailUrl ? (
          // Served straight from the archive: a result is a preview, and
          // only the chosen one is ever copied here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnailUrl} alt="" loading="lazy" />
        ) : null}
        <span className={styles.kind}>{asset.mediaType === "video" ? "video" : "photo"}</span>
        {asset.durationSeconds !== null && (
          <span className={styles.dur}>{fmtDuration(asset.durationSeconds)}</span>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.title} title={asset.title}>
          {asset.title}
        </div>
        {/* Joined from a filtered list rather than concatenated with its own
            separators: a suggestion carries no width/height (the library row
            the AI run stores has none), so the hand-written version printed
            "NASA ·  · dated 1969" on every card in the suggestions bar. */}
        <div className={styles.meta}>{metaLine(asset)}</div>
        <span className={`${styles.lic} ${styles[chip.cls]}`} title={chip.title}>
          {chip.text}
        </span>
        {asset.reviewStatus === "manual_review" && asset.reviewReason && (
          <div className={styles.meta}>{asset.reviewReason}</div>
        )}
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
        <input
          type="number"
          min={3}
          max={20}
          step={1}
          value={seconds}
          onChange={(e) => onSeconds(e.target.value)}
        />
        s
      </label>
    </div>
  );
}

export const actionsClass = styles.actions;
