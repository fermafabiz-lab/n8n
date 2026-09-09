"use client";

/**
 * Search real footage, and put one result on the scene.
 *
 * Lives on the Images step of a Documentary project, under the picture,
 * because that is where the picture is decided. The search goes to
 * /api/footage/search WITH the scene's id, so the Universal Footage Engine
 * has the scene's own narration to match against and answers BEST MATCHES —
 * every provider's results ranked together, each with its score, its rights
 * class and the provenance it would carry for this scene. The producer is
 * choosing footage, not managing archives; the provider filter is there for
 * the day it matters and hidden until then.
 *
 * "Use" is the `useArchiveAsset` server action, which downloads or cuts the
 * asset, makes the clip, and writes the scene in one transaction. Two more
 * doors open from here: a pasted URL and an upload, both filing into the
 * same library the search reads.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useArchiveAsset, type ActionResult } from "@/app/actions";
import type { NormalizedArchiveAsset } from "@/lib/archive/types";
import ArchiveCard, { ArchiveUseOptions, actionsClass, licenceChip } from "./ArchiveCard";
import FootageImport from "./FootageImport";
import FootageUpload from "./FootageUpload";
import styles from "./ArchivePicker.module.css";

type Hit = NormalizedArchiveAsset & {
  id: string | null;
  status: string | null;
  score: number;
  reasons: string[];
  usage: string;
  usageReason: string | null;
  matchProvenance: string;
  matchConfidence: number;
};
type Kind = "any" | "video" | "image";
interface Report {
  provider: string;
  displayName: string;
  enabled: boolean;
  routed: boolean;
  reason: string | null;
  count: number;
  ms: number;
}
interface ProviderOption {
  id: string;
  displayName: string;
  enabled: boolean;
  disabledReason: string | null;
  heldBack: string | null;
}

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
  const [report, setReport] = useState<Report[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [only, setOnly] = useState<string | null>(null);
  const [showProviders, setShowProviders] = useState(false);
  const [door, setDoor] = useState<"search" | "url" | "upload">("search");
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
    // The provider list, for the filter — fetched once, failure means no filter.
    fetch("/api/footage/providers")
      .then((r) => r.json())
      .then((b: { ok: boolean; providers?: ProviderOption[] }) => {
        if (b.ok && b.providers) setProviders(b.providers);
      })
      .catch(() => {});
    return () => abortRef.current?.abort();
  }, []);

  const search = useCallback(
    async (query: string, k: Kind, provider: string | null) => {
      const text = query.trim();
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams({ scene: sceneId, type: k, limit: "16" });
        if (text.length >= 2) params.set("q", text);
        if (provider) params.set("providers", provider);
        const res = await fetch(`/api/footage/search?${params.toString()}`, { signal: ctl.signal });
        const body = (await res.json()) as { ok: boolean; error?: string; results?: Hit[]; providers?: Report[]; source?: string };
        if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setHits(body.results ?? []);
        setReport(body.providers ?? []);
        setSource(body.source ?? null);
        setSearched(true);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setErr((e as Error).message);
      } finally {
        if (abortRef.current === ctl) setLoading(false);
      }
    },
    [sceneId],
  );

  const key = (a: Hit) => `${a.provider}:${a.providerAssetId}`;
  const asked = report.filter((p) => p.routed);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h6>Search real footage</h6>
        <div className={styles.doors}>
          <button type="button" className="abtn" aria-pressed={door === "url"} onClick={() => setDoor(door === "url" ? "search" : "url")} disabled={pending}>
            + Add from URL
          </button>
          <button type="button" className="abtn" aria-pressed={door === "upload"} onClick={() => setDoor(door === "upload" ? "search" : "upload")} disabled={pending}>
            ⬆ Upload
          </button>
          <button type="button" className="abtn" onClick={onClose} disabled={pending}>
            Close
          </button>
        </div>
      </div>
      {hint && <p className={styles.hint}>This shot is under: “{hint}”</p>}

      {door === "url" && (
        <FootageImport
          onSaved={() => {
            setDoor("search");
            void search(q, kind, "url_import");
            setOnly("url_import");
          }}
          onClose={() => setDoor("search")}
        />
      )}
      {door === "upload" && (
        <FootageUpload
          onSaved={() => {
            setDoor("search");
            void search(q, kind, "user_upload");
            setOnly("user_upload");
          }}
          onClose={() => setDoor("search")}
        />
      )}

      {door === "search" && (
        <>
          <div className={styles.row}>
            <input
              ref={inputRef}
              className={styles.q}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void search(q, kind, only);
                }
              }}
              placeholder="Leave empty to search from the scene's own words, or narrow it: “Ceuta border 2026”, “Apollo 11 launch”"
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
                    if (searched) void search(q, k, only);
                  }}
                >
                  {k === "any" ? "Any" : k === "video" ? "Video" : "Photos"}
                </button>
              ))}
            </div>
            <button type="button" className="abtn ok" disabled={pending || loading} onClick={() => void search(q, kind, only)}>
              {loading ? "Searching…" : "Find best matches"}
            </button>
            <button type="button" className={styles.link} onClick={() => setShowProviders((v) => !v)}>
              {showProviders ? "hide providers" : only ? `provider: ${providers.find((p) => p.id === only)?.displayName ?? only}` : "all providers"}
            </button>
          </div>

          {/* The provider filter: optional, and hidden until asked for. The
              producer is selecting footage, not managing archives. */}
          {showProviders && (
            <div className={styles.providers} role="group" aria-label="Provider">
              <button type="button" aria-pressed={only === null} onClick={() => { setOnly(null); if (searched) void search(q, kind, null); }}>
                All providers
              </button>
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={only === p.id}
                  disabled={!p.enabled}
                  title={p.disabledReason ?? p.heldBack ?? ""}
                  onClick={() => { setOnly(p.id); if (searched) void search(q, kind, p.id); }}
                >
                  {p.displayName}
                  {!p.enabled ? " (off)" : p.heldBack ? " (held)" : ""}
                </button>
              ))}
            </div>
          )}

          {err && <p className={`${styles.status} ${styles.err}`}>{err}</p>}
          {searched && !loading && hits.length === 0 && !err && (
            <p className={styles.status}>
              Nothing usable for that. Try the event, the place or the year in English — the archives are catalogued that way — or add footage from a URL.
            </p>
          )}

          {hits.length > 0 && (
            <>
              <p className={styles.status}>
                <b>Best matches</b>
                {source === "library" ? " · from the library" : source === "cache" ? " · from a recent search" : ""}
                {asked.length ? ` · asked ${asked.filter((p) => !p.reason).map((p) => p.displayName).join(", ")}` : ""}
              </p>
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
                    provider: a.provider,
                    score: a.score,
                    provenance: a.matchProvenance,
                    usage: a.usage,
                    usageReason: a.usageReason,
                    filmingDate: a.filmingDate ?? null,
                    location: a.location ?? null,
                    eventName: a.eventName ?? null,
                    footageFormat: a.footageFormat ?? null,
                  };
                  const chip = licenceChip(asset);
                  const usable = a.usage !== "restricted" && a.reviewStatus !== "rejected";
                  const isSel = selected === k;
                  const secs = seconds[k] ?? String(DEFAULT_SECONDS);
                  const off = offset[k] ?? "0";
                  const noFile = a.downloadUrl === a.sourceUrl && a.provider === "url_import";
                  return (
                    <ArchiveCard key={k} asset={asset} selected={isSel} onSelect={() => setSelected(k)}>
                      {isSel && a.reasons.length > 0 && <div className={styles.why}>{a.reasons.join(" · ")}</div>}
                      {isSel && usable && !noFile && (
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
                          disabled={pending || !usable || !a.id || noFile}
                          title={
                            !a.id
                              ? "Not filed in the library — the search could not save it, so it cannot be used yet"
                              : noFile
                                ? "No media file was found on that page — it is a reference only"
                                : usable
                                  ? a.usage === "manual_review" || a.usage === "editorial_only"
                                    ? "Rights need your decision — using it IS that decision, and it is recorded"
                                    : "Download the asset, make the scene's clip, and put both on this scene"
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
                          {a.usage === "manual_review" || a.usage === "editorial_only" ? "Use — I accept the rights" : "Use for this scene"}
                        </button>
                        <a href={a.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          source ↗
                        </a>
                      </div>
                    </ArchiveCard>
                  );
                })}
              </div>
            </>
          )}

          {searched && report.length > 0 && (
            <ul className={styles.providerReport}>
              {report
                .filter((p) => p.routed)
                .map((p) => (
                  <li key={p.provider} title={p.reason ?? ""}>
                    {p.displayName}: {p.reason ? (p.enabled ? `— ${p.reason}` : p.reason) : `${p.count} found${p.ms ? ` in ${(p.ms / 1000).toFixed(1)}s` : ""}`}
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
