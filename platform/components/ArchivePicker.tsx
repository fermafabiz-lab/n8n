"use client";

/**
 * Search the free archives and put one result on the scene.
 *
 * Lives on the Images step of a Documentary project, under the AI controls,
 * because that is where the picture is decided. Search goes to
 * /api/archive/search with the browser's own session; "Use" is the
 * `useArchiveAsset` server action, which downloads or cuts the asset, makes
 * the clip, and writes the scene in one transaction.
 *
 * The card itself is `ArchiveCard`, shared with the AI suggestions bar, so
 * a licence reads the same wherever it appears. Relevance is the producer's
 * call, and the picker does not pretend otherwise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useArchiveAsset, type ActionResult } from "@/app/actions";
import type { NormalizedArchiveAsset } from "@/lib/archive/types";
import type { ProviderReport } from "@/lib/archive";
import ArchiveCard, { ArchiveUseOptions, actionsClass, licenceChip } from "./ArchiveCard";
import styles from "./ArchivePicker.module.css";

type Hit = NormalizedArchiveAsset & { id: string | null; status: string | null };
type Kind = "any" | "video" | "image";

const DEFAULT_SECONDS = 8;

export default function ArchivePicker({
  projectId,
  sceneId,
  hint,
  run,
  pending,
  onClose,
}: {
  projectId: string;
  sceneId: string;
  /** The scene's narration, so the producer remembers what the shot is for. */
  hint?: string | null;
  /** The board's own action runner — one pending state, one message line. */
  run: (fn: () => Promise<ActionResult>) => void;
  pending: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("any");
  const [hits, setHits] = useState<Hit[]>([]);
  const [providers, setProviders] = useState<ProviderReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => abortRef.current?.abort();
  }, []);

  const search = useCallback(async (query: string, k: Kind) => {
    const text = query.trim();
    if (text.length < 2) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/archive/search?q=${encodeURIComponent(text)}&type=${k}&limit=12`,
        { signal: ctl.signal },
      );
      const body = (await res.json()) as {
        ok: boolean;
        error?: string;
        results?: Hit[];
        providers?: ProviderReport[];
        filingError?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setHits(body.results ?? []);
      setProviders(body.providers ?? []);
      setSearched(true);
      if (body.filingError) setErr(`Found, but not filed in the library: ${body.filingError}`);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr((e as Error).message);
    } finally {
      if (abortRef.current === ctl) setLoading(false);
    }
  }, []);

  const key = (a: Hit) => `${a.provider}:${a.providerAssetId}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h6>Archive footage — Wikimedia Commons (NARA and Smithsonian once their keys exist)</h6>
        <button type="button" className="abtn" onClick={onClose} disabled={pending}>
          Close
        </button>
      </div>
      {hint && <p className={styles.hint}>This shot is under: “{hint}”</p>}
      <div className={styles.row}>
        <input
          ref={inputRef}
          className={styles.q}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void search(q, kind);
            }
          }}
          placeholder="e.g. Apollo 11 launch 1969, Ford assembly line, Bucharest 1930s"
          disabled={pending}
        />
        <div className={styles.seg} role="group" aria-label="Kind">
          {(["any", "video", "image"] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                if (searched) void search(q, k);
              }}
            >
              {k === "any" ? "Any" : k === "video" ? "Video" : "Photos"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="abtn"
          disabled={pending || loading || q.trim().length < 2}
          onClick={() => void search(q, kind)}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {err && <p className={`${styles.status} ${styles.err}`}>{err}</p>}
      {searched && !loading && hits.length === 0 && !err && (
        <p className={styles.status}>
          Nothing in the archives for that. Try the event, the place or the year in English — the
          libraries are catalogued that way.
        </p>
      )}

      {hits.length > 0 && (
        <div className={styles.grid}>
          {hits.map((a) => {
            const k = key(a);
            const asset = {
              title: a.title,
              mediaType: a.mediaType,
              thumbnailUrl: a.thumbnailUrl,
              sourceUrl: a.sourceUrl,
              creator: a.creator,
              license: a.licenseOriginal,
              reviewStatus: a.reviewStatus,
              reviewReason: a.reviewReason,
              shareAlike: a.modifications === "share_alike",
              attributionRequired: a.attributionRequired,
              durationSeconds: a.durationSeconds,
              dateOriginal: a.dateOriginal,
              yearsMentioned: a.yearsMentioned,
              width: a.width,
              height: a.height,
            };
            const chip = licenceChip(asset);
            const usable = a.reviewStatus !== "rejected";
            const isSel = selected === k;
            const secs = seconds[k] ?? String(DEFAULT_SECONDS);
            const off = offset[k] ?? "0";
            return (
              <ArchiveCard key={k} asset={asset} selected={isSel} onSelect={() => setSelected(k)}>
                {isSel && usable && (
                  <ArchiveUseOptions
                    isVideo={a.mediaType === "video"}
                    offset={off}
                    seconds={secs}
                    onOffset={(v) => setOffset((p) => ({ ...p, [k]: v }))}
                    onSeconds={(v) => setSeconds((p) => ({ ...p, [k]: v }))}
                  />
                )}
                <div className={actionsClass}>
                  <button
                    type="button"
                    className="abtn ok"
                    disabled={pending || !usable || !a.id}
                    title={
                      !a.id
                        ? "Not filed in the library — the search could not save it, so it cannot be used yet"
                        : usable
                          ? "Download the asset, make the scene's clip, and put both on this scene"
                          : chip.title
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!a.id) return;
                      const id = a.id;
                      run(async () => {
                        const r = await useArchiveAsset(projectId, sceneId, id, {
                          offsetSeconds: Number(off) || 0,
                          seconds: Number(secs) || DEFAULT_SECONDS,
                        });
                        if (r.ok) onClose();
                        return r;
                      });
                    }}
                  >
                    Use for this scene
                  </button>
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    source ↗
                  </a>
                </div>
              </ArchiveCard>
            );
          })}
        </div>
      )}

      {searched && providers.length > 0 && (
        <ul className={styles.providers}>
          {providers.map((p) => (
            <li key={p.provider} title={p.reason ?? ""}>
              {p.provider}: {p.reason ? (p.enabled ? `error — ${p.reason}` : p.reason) : `${p.count} found`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
