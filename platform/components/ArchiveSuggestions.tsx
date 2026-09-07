"use client";

/**
 * "Suggested archive footage" — what the AI run proposed for this scene.
 *
 * Three honest states, because they read identically otherwise and the
 * difference decides what the producer does next:
 *   - picks exist → the bar, best first, each with the model's reason;
 *   - looked at, nothing relevant → one quiet line: this scene will be
 *     generated (the producer can still search by hand);
 *   - not looked at yet → a line saying so, with the manual door, since the
 *     run is fired by a scene approval and a run that died leaves nothing
 *     behind to say why.
 *
 * "Use" goes through the exact attach path the hand-searched picker uses;
 * a suggestion is an offer, never a decision made for the producer.
 */

import { useState } from "react";
import { requestArchiveSuggestions, useArchiveAsset, type ActionResult } from "@/app/actions";
import type { Scene } from "@/lib/data";
import ArchiveCard, { ArchiveUseOptions, actionsClass } from "./ArchiveCard";
import styles from "./ArchiveSuggestions.module.css";

const DEFAULT_SECONDS = 8;

export default function ArchiveSuggestions({
  projectId,
  scene,
  run,
  pending,
}: {
  projectId: string;
  scene: Scene;
  run: (fn: () => Promise<ActionResult>) => void;
  pending: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState<Record<string, string>>({});

  const picks = scene.archiveSuggestions;
  const lookAgain = (
    <button
      type="button"
      className="abtn"
      disabled={pending}
      title="Ask the AI to look for archive footage again, for every scene of this film that has no clip yet"
      onClick={() => run(() => requestArchiveSuggestions(projectId))}
    >
      ✨ Look for archive footage
    </button>
  );

  if (picks.length === 0) {
    return (
      <div className={styles.quiet}>
        {scene.archiveSuggestedAt ? (
          <span>AI found no relevant archive footage for this scene — it will be generated.</span>
        ) : (
          <span>AI has not looked for archive footage for this scene yet.</span>
        )}
        {lookAgain}
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      <div className={styles.head}>
        <h6>Suggested archive footage · AI found {picks.length} for this scene</h6>
        <span className={styles.sub}>
          Pick one to use it instead of a generated picture, or leave the scene to be generated.
        </span>
      </div>
      <div className={styles.row}>
        {picks.map((p) => {
          const isSel = selected === p.stockId;
          const secs = seconds[p.stockId] ?? String(DEFAULT_SECONDS);
          const off = offset[p.stockId] ?? "0";
          const usable = p.reviewStatus !== "rejected";
          return (
            <ArchiveCard
              key={p.stockId}
              asset={{
                title: p.title,
                mediaType: p.mediaType,
                thumbnailUrl: p.thumbnailUrl,
                sourceUrl: p.sourceUrl,
                creator: p.creator,
                license: p.license,
                reviewStatus: p.reviewStatus,
                durationSeconds: p.durationSeconds,
                dateOriginal: p.dateOriginal,
                yearsMentioned: p.yearsMentioned,
              }}
              selected={isSel}
              onSelect={() => setSelected(p.stockId)}
              style={{ flex: "0 0 200px", width: 200 }}
            >
              {p.reason && (
                <div className={styles.why} title={p.reason}>
                  {p.reason}
                  {p.relevance !== null && (
                    <span className={styles.score}> · {Math.round(p.relevance * 100)}%</span>
                  )}
                </div>
              )}
              {isSel && usable && (
                <ArchiveUseOptions
                  isVideo={p.mediaType === "video"}
                  offset={off}
                  seconds={secs}
                  onOffset={(v) => setOffset((o) => ({ ...o, [p.stockId]: v }))}
                  onSeconds={(v) => setSeconds((o) => ({ ...o, [p.stockId]: v }))}
                />
              )}
              <div className={actionsClass}>
                <button
                  type="button"
                  className="abtn ok"
                  disabled={pending || !usable}
                  onClick={(e) => {
                    e.stopPropagation();
                    run(() =>
                      useArchiveAsset(projectId, scene.id, p.stockId, {
                        offsetSeconds: Number(off) || 0,
                        seconds: Number(secs) || DEFAULT_SECONDS,
                      }),
                    );
                  }}
                >
                  Use
                </button>
                <a href={p.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  source ↗
                </a>
              </div>
            </ArchiveCard>
          );
        })}
      </div>
    </div>
  );
}
