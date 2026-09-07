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
 * What the card shows is chosen for the decision the producer is making:
 * the licence verdict as a coloured chip WITH its reason (a share-alike
 * obligation is an obligation), the provider's date string exactly as given
 * (it lies — see NormalizedArchiveAsset.dateOriginal — so it is labelled
 * "dated", not "from"), and the years the description mentions, which are
 * the nearest thing to a period the metadata offers. Relevance is the
 * producer's call, and the picker does not pretend otherwise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useArchiveAsset, type ActionResult } from "@/app/actions";
import type { NormalizedArchiveAsset } from "@/lib/archive/types";
import type { ProviderReport } from "@/lib/archive";
import styles from "./ArchivePicker.module.css";

type Hit = NormalizedArchiveAsset & { id: string | null; status: string | null };
type Kind = "any" | "video" | "image";

const DEFAULT_SECONDS = 8;

function licenceChip(a: Hit): { cls: string; text: string; title: string } {
  const lic = a.licenseOriginal ?? a.rightsStatus.replace(/_/g, " ");
  if (a.reviewStatus === "rejected")
    return { cls: "bad", text: `✕ ${lic}`, title: a.reviewReason ?? "Licence forbids this use" };
  if (a.reviewStatus === "manual_review")
    return { cls: "warn", text: `? ${lic}`, title: a.reviewReason ?? "Check the licence before use" };
  const sa = a.modifications === "share_alike" ? " · share-alike" : "";
  const credit = a.attributionRequired ? " · credit" : "";
  return { cls: "ok", text: `✓ ${lic}${sa}${credit}`, title: "Auto-approved by the licence rules" };
}

const fmtDur = (s: number | null) => {
  if (s === null) return null;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
};

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

  const search = useCallback(
    async (query: string, k: Kind) => {
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
    },
    [],
  );

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
            const chip = licenceChip(a);
            const usable = a.reviewStatus !== "rejected";
            const isSel = selected === k;
            const secs = seconds[k] ?? String(DEFAULT_SECONDS);
            const off = offset[k] ?? "0";
            return (
              <div
                key={k}
                className={`${styles.card}${isSel ? ` ${styles.sel}` : ""}`}
                onClick={() => setSelected(k)}
              >
                <div className={styles.thumb}>
                  {a.thumbnailUrl ? (
                    // Served straight from the archive: a search result is a
                    // preview, and only the chosen one is ever copied here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailUrl} alt="" loading="lazy" />
                  ) : null}
                  <span className={styles.kind}>{a.mediaType === "video" ? "video" : "photo"}</span>
                  {a.durationSeconds !== null && (
                    <span className={styles.dur}>{fmtDur(a.durationSeconds)}</span>
                  )}
                </div>
                <div className={styles.body}>
                  <div className={styles.title} title={a.title}>
                    {a.title}
                  </div>
                  <div className={styles.meta}>
                    {a.creator ? `${a.creator} · ` : ""}
                    {a.width && a.height ? `${a.width}×${a.height}` : ""}
                    {a.dateOriginal ? ` · dated ${a.dateOriginal}` : ""}
                    {a.yearsMentioned.length
                      ? ` · mentions ${a.yearsMentioned.slice(0, 3).join(", ")}`
                      : ""}
                  </div>
                  <span className={`${styles.lic} ${styles[chip.cls]}`} title={chip.title}>
                    {chip.text}
                  </span>
                  {a.reviewStatus === "manual_review" && a.reviewReason && (
                    <div className={styles.meta}>{a.reviewReason}</div>
                  )}
                  {isSel && usable && (
                    <div className={styles.opts} onClick={(e) => e.stopPropagation()}>
                      {a.mediaType === "video" && (
                        <label>
                          start at
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={off}
                            onChange={(e) => setOffset((p) => ({ ...p, [k]: e.target.value }))}
                          />
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
                          value={secs}
                          onChange={(e) => setSeconds((p) => ({ ...p, [k]: e.target.value }))}
                        />
                        s
                      </label>
                    </div>
                  )}
                  <div className={styles.row}>
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
                </div>
              </div>
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
