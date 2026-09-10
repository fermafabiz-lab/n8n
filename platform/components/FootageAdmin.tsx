"use client";

/**
 * The footage library, for a person who curates it: filter, inspect, verify,
 * reject, retag, change provenance, remove — plus the two doors that add to
 * it, URL import and upload.
 *
 * Filters live in the URL, so a view can be bookmarked and the page can be
 * server-rendered from them (the list itself is fetched by the server page;
 * this component is the controls and the cards). Every action is a server
 * action in app/admin/footage/actions.ts and re-renders the page.
 */

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { StockMedia } from "@/lib/data/stock";
import type { ActionResult } from "@/app/actions";
import { deleteFootage, rejectFootage, updateFootage, useFootageInScene, verifyFootage } from "@/app/admin/footage/actions";
import { USAGE_LABELS } from "@/lib/footage/rights";
import { validateRights } from "@/lib/footage/rights";
import { providerLabel } from "@/lib/provenance";
import ArchiveCard, { actionsClass } from "./ArchiveCard";
import FootageImport from "./FootageImport";
import FootageUpload from "./FootageUpload";
import styles from "./FootageAdmin.module.css";

// The provider chips are the registry's own list (it arrives as `health`),
// so a new adapter shows up here the day it lands and nothing is retyped.
const PROVIDER_FILTERS: Array<{ id: string; label: string }> = [{ id: "all", label: "All" }];

const PROVENANCES = ["actual_footage", "illustrative_footage", "archival_footage", "archival_photo", "real_stock", "unknown"] as const;

export default function FootageAdmin({
  rows,
  total,
  extraProviders,
  health,
}: {
  rows: StockMedia[];
  total: number;
  /** Providers the library holds that are not in the fixed filter list (retired ones). */
  extraProviders: Array<{ provider: string; n: number }>;
  health: Array<{ id: string; displayName: string; enabled: boolean; disabledReason: string | null; notice: string | null; heldBack: string | null; searches: number; results: number; selected: number; avgScore: number | null; avgMs: number | null; lastError: string | null }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [door, setDoor] = useState<"none" | "url" | "upload">("none");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const get = (k: string, d = "") => params.get(k) ?? d;
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== "all" && v !== "any") next.set(k, v);
      else next.delete(k);
    }
    next.delete("offset");
    router.push(`/admin/footage?${next.toString()}`);
  };
  const act = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (r.ok) router.refresh();
    });

  return (
    <div className={styles.wrap}>
      {/* Provider health strip — which archives answer, and how well. */}
      <div className={styles.health}>
        {health.map((h) => (
          <div key={h.id} className={`${styles.hcard} ${!h.enabled ? styles.hoff : h.heldBack ? styles.hheld : ""}`} title={h.disabledReason ?? h.heldBack ?? h.notice ?? h.lastError ?? ""}>
            <b>{h.displayName}</b>
            <span>{!h.enabled ? h.disabledReason ?? "off" : h.heldBack ? "held back" : h.searches ? `${h.searches} searches · ${h.results} results · ${h.selected} used` : h.notice ?? "not asked yet"}</span>
            {/* An enabled provider with a caveat (anonymous, low quota) says so
                even once it has been asked — the counts alone would read as a
                source in full working order. */}
            {h.enabled && h.notice && h.searches > 0 && <span>{h.notice}</span>}
            {h.enabled && h.searches > 0 && (
              <span>
                {h.avgScore !== null ? `avg score ${h.avgScore}` : ""}
                {h.avgMs !== null ? ` · ${(h.avgMs / 1000).toFixed(1)}s` : ""}
              </span>
            )}
            {h.lastError && <span className={styles.herr}>{h.lastError}</span>}
          </div>
        ))}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label="Provider">
          {[...PROVIDER_FILTERS, ...health.map((h) => ({ id: h.id, label: h.displayName }))].map((p) => (
            <button key={p.id} type="button" aria-pressed={get("provider", "all") === p.id} onClick={() => set({ provider: p.id })}>
              {p.label}
            </button>
          ))}
          {extraProviders.map((p) => (
            <button key={p.provider} type="button" aria-pressed={get("provider") === p.provider} onClick={() => set({ provider: p.provider })} title="A retired provider — its rows stay readable, no new search reaches it">
              {providerLabel(p.provider)} ({p.n})
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          <select value={get("type", "any")} onChange={(e) => set({ type: e.target.value })}>
            <option value="any">Video + photos</option>
            <option value="video">Video</option>
            <option value="image">Photos</option>
          </select>
          <select value={get("origin", "any")} onChange={(e) => set({ origin: e.target.value })}>
            <option value="any">Recent + historical</option>
            <option value="recent">Recent / official</option>
            <option value="historical">Historical</option>
            <option value="user_upload">Uploads</option>
          </select>
          <select value={get("rights", "any")} onChange={(e) => set({ rights: e.target.value })}>
            <option value="any">Any rights</option>
            <option value="auto_approved">Cleared / credit</option>
            <option value="manual_review">Manual review</option>
            <option value="rejected">Restricted</option>
          </select>
          <select value={get("status", "any")} onChange={(e) => set({ status: e.target.value })}>
            <option value="any">Any decision</option>
            <option value="candidate">Not reviewed</option>
            <option value="approved">Verified</option>
            <option value="used">Used in a film</option>
            <option value="rejected">Rejected</option>
          </select>
          <select value={get("provenance", "any")} onChange={(e) => set({ provenance: e.target.value })}>
            <option value="any">Any provenance</option>
            {PROVENANCES.map((p) => (
              <option key={p} value={p}>
                {p.replace("_", " ")}
              </option>
            ))}
          </select>
          <input placeholder="event" defaultValue={get("event")} onKeyDown={(e) => { if (e.key === "Enter") set({ event: (e.target as HTMLInputElement).value }); }} />
          <input placeholder="country / place" defaultValue={get("country")} onKeyDown={(e) => { if (e.key === "Enter") set({ country: (e.target as HTMLInputElement).value }); }} />
          <input placeholder="year" defaultValue={get("year")} inputMode="numeric" onKeyDown={(e) => { if (e.key === "Enter") set({ year: (e.target as HTMLInputElement).value }); }} />
          <input placeholder="search text ⏎" defaultValue={get("q")} onKeyDown={(e) => { if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value }); }} />
        </div>
        <div className={styles.doors}>
          <button type="button" className="abtn" aria-pressed={door === "url"} onClick={() => setDoor(door === "url" ? "none" : "url")}>
            + Add footage from URL
          </button>
          <button type="button" className="abtn" aria-pressed={door === "upload"} onClick={() => setDoor(door === "upload" ? "none" : "upload")}>
            ⬆ Upload footage
          </button>
          <span className={styles.count}>{total} in the library</span>
        </div>
      </div>

      {door === "url" && <FootageImport onSaved={() => { setDoor("none"); router.refresh(); }} onClose={() => setDoor("none")} />}
      {door === "upload" && <FootageUpload onSaved={() => { setDoor("none"); router.refresh(); }} onClose={() => setDoor("none")} />}

      {msg && <p className={`${styles.msg} ${msg.ok ? styles.ok : styles.err}`}>{msg.message}</p>}

      <div className={styles.grid}>
        {rows.map((a) => {
          const rights = validateRights(a);
          const isOpen = open === a.id;
          return (
            <ArchiveCard
              key={a.id}
              asset={{
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
                provenance: a.provenance ?? "unknown",
                usage: rights.status,
                usageReason: rights.reason ?? null,
                filmingDate: a.filmingDate ?? null,
                location: a.location ?? null,
                eventName: a.eventName ?? null,
                footageFormat: a.footageFormat ?? null,
              }}
              selected={isOpen}
              onSelect={() => setOpen(isOpen ? null : a.id)}
            >
              <div className={styles.facts}>
                {a.eventName ? `event: ${a.eventName} · ` : ""}
                {USAGE_LABELS[rights.status]} · {a.status}
                {a.provenanceConfidence !== undefined ? ` · confidence ${a.provenanceConfidence}%` : ""}
                {a.verifiedAt ? " · verified" : ""}
              </div>
              <div className={actionsClass}>
                <a href={a.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  open source ↗
                </a>
                {a.downloadUrl !== a.sourceUrl && (
                  <a href={a.downloadUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    preview ↗
                  </a>
                )}
              </div>
              {isOpen && (
                <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
                  <div className={styles.rowb}>
                    <button type="button" className="abtn ok" disabled={pending || a.reviewStatus === "rejected"} onClick={() => act(() => verifyFootage(a.id))}>
                      Verify
                    </button>
                    <button type="button" className="abtn" disabled={pending} onClick={() => act(() => rejectFootage(a.id))}>
                      Reject
                    </button>
                    <button
                      type="button"
                      className="abtn"
                      disabled={pending}
                      onClick={() => {
                        const target = window.prompt("Put this on a scene — paste the scene id (rec…) and the project id (rec…), separated by a space:");
                        if (!target) return;
                        const [scene, project] = target.trim().split(/\s+/);
                        if (!scene || !project) {
                          setMsg({ ok: false, message: "Two ids, please: scene then project." });
                          return;
                        }
                        act(() => useFootageInScene(a.id, project, scene));
                      }}
                    >
                      Use in scene…
                    </button>
                    <button
                      type="button"
                      className="abtn"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm("Remove this from the local index? Scenes that already use it keep their files.")) act(() => deleteFootage(a.id));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <form
                    className={styles.form}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      act(() => updateFootage(a.id, fd));
                    }}
                  >
                    <label>
                      Title
                      <input name="title" defaultValue={a.title} />
                    </label>
                    <label>
                      Event
                      <input name="eventName" defaultValue={a.eventName ?? ""} />
                    </label>
                    <div className={styles.two}>
                      <label>
                        Where
                        <input name="location" defaultValue={a.location ?? ""} />
                      </label>
                      <label>
                        Country
                        <input name="country" defaultValue={a.country ?? ""} />
                      </label>
                    </div>
                    <div className={styles.two}>
                      <label>
                        When shot
                        <input name="filmingDate" defaultValue={a.filmingDate ?? ""} />
                      </label>
                      <label>
                        Credit
                        <input name="credit" defaultValue={a.credit ?? ""} />
                      </label>
                    </div>
                    <label>
                      Tags (comma-separated)
                      <input name="categories" defaultValue={a.categories.join(", ")} />
                    </label>
                    <div className={styles.two}>
                      <label>
                        People
                        <input name="people" defaultValue={(a.people ?? []).join(", ")} />
                      </label>
                      <label>
                        Organisations
                        <input name="organizations" defaultValue={(a.organizations ?? []).join(", ")} />
                      </label>
                    </div>
                    <div className={styles.two}>
                      <label>
                        Provenance
                        <select name="provenance" defaultValue={a.provenance ?? "unknown"}>
                          {PROVENANCES.map((p) => (
                            <option key={p} value={p}>
                              {p.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Rights
                        <select name="rights" defaultValue="">
                          <option value="">(leave as classified)</option>
                          <option value="cleared">Cleared</option>
                          <option value="attribution_required">Credit required</option>
                          <option value="manual_review">Manual review</option>
                          <option value="restricted">Restricted</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Notes
                      <textarea name="notes" rows={2} defaultValue={a.notes ?? ""} />
                    </label>
                    {a.rightsText && <p className={styles.rt}>Provider&rsquo;s rights text: {a.rightsText}</p>}
                    <div className={styles.rowb}>
                      <button type="submit" className="abtn ok" disabled={pending}>
                        Save changes
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </ArchiveCard>
          );
        })}
      </div>
      {rows.length === 0 && <p className={styles.msg}>Nothing matches these filters.</p>}
      {total > rows.length && (
        <div className={styles.rowb}>
          <button
            type="button"
            className="abtn"
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.set("offset", String((Number(get("offset")) || 0) + rows.length));
              router.push(`/admin/footage?${next.toString()}`);
            }}
          >
            Next {Math.min(60, total - rows.length - (Number(get("offset")) || 0))} →
          </button>
        </div>
      )}
    </div>
  );
}
