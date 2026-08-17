"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteProjects, type ActionResult } from "@/app/actions";
import ExpandableTitle from "@/components/ExpandableTitle";
import type { Project, StatusKind } from "@/lib/data";
import { mediaSrc } from "@/lib/media";

function badgeLabel(p: Project): string {
  switch (p.statusKind) {
    case "wait":
      return "Needs review";
    case "run":
      return "Rendering";
    case "done":
      return "Finished";
    case "err":
      return "Needs a fix";
    default:
      return p.status;
  }
}

const FILTERS: Array<{ key: "all" | StatusKind; label: string }> = [
  { key: "all", label: "All" },
  { key: "wait", label: "Needs you" },
  { key: "run", label: "Rendering" },
  { key: "done", label: "Finished" },
  { key: "err", label: "Failed" },
  // Anything whose status the map does not recognise. Without this tab those
  // projects were counted in "All" and reachable from no tab at all, so the
  // numbers across the top could not be made to add up — and a project you
  // cannot open is a project you cannot delete either. The label stays vague
  // because the bucket is: every card in it shows its own status text.
  { key: "idle", label: "Other" },
];

const short = (s: string, n: number) =>
  s.length > n ? s.slice(0, n).trimEnd() + "…" : s;

/**
 * Dashboard projects: filter tabs (a hundred projects is a wall without
 * them), a grid/index view toggle — the index being the editorial list that
 * makes that wall scannable — and a manage mode where Select turns entries
 * into checkboxes and a two-step Delete removes every selected project
 * (scenes + scripts + project record; Drive media stays).
 */
/** Projects per page. */
const PAGE_SIZE = 15;

/**
 * The page numbers to actually draw: always the first and last, always the
 * current and its neighbours, with an ellipsis standing in for the rest. A
 * library of 57 films is four pages and needs none of this; one of 600 is
 * forty, and forty pills is not a control, it is a wall.
 */
function pageNumbers(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | "gap"> = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  if (lo > 2) out.push("gap");
  for (let n = lo; n <= hi; n++) out.push(n);
  if (hi < total - 1) out.push("gap");
  out.push(total);
  return out;
}

/**
 * The card's first meta word. The film's own category when it has one (they
 * are what the library is actually sorted by in a producer's head), falling
 * back to the tone, which every project has.
 */
function categoryLabel(p: { category: string | null; tone: string | null }): string {
  if (p.category) {
    return p.category.charAt(0).toUpperCase() + p.category.slice(1);
  }
  return p.tone || "Film";
}

/** mm:ss — the runtime chip on the still and the card's meta line. */
function runtimeOf(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

/**
 * "4 min ago". Deliberately coarse: the card is scanned, and a timestamp to
 * the second invites reading it as progress when it is only a write time.
 */
function agoOf(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export default function ProjectsGrid({ projects }: { projects: Project[] }) {
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | StatusKind>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  /** Filters title and category live, exactly as the design's search does. */
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  // Hover preview on finished covers: the final video plays muted in the
  // card. Mounted only after ~350ms of hover intent — the bytes come through
  // our own /api/media proxy (Drive-hosted), so drive-by hovers must not
  // start downloads.
  const [preview, setPreview] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);
  const canPreview = (p: Project) =>
    !manage && p.statusKind === "done" && !!p.finalVideoUrl?.startsWith("http");
  const armPreview = (p: Project) => {
    if (!canPreview(p)) return;
    // Reduced motion: the reveal animation is stripped globally, which would
    // leave the video invisible while it still streams through our proxy.
    // Skip the preview entirely — no download for zero visible effect.
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {}
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreview(p.id), 350);
  };
  const disarmPreview = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    setPreview(null);
  };

  // The view survives visits; a preference, not a state.
  useEffect(() => {
    try {
      if (localStorage.getItem("hov-view") === "list") setView("list");
    } catch {}
  }, []);
  const pickView = (v: "grid" | "list") => {
    setView(v);
    try {
      localStorage.setItem("hov-view", v);
    } catch {}
  };

  const counts = new Map<string, number>([["all", projects.length]]);
  for (const p of projects) counts.set(p.statusKind, (counts.get(p.statusKind) ?? 0) + 1);
  const q = query.trim().toLowerCase();
  const matched = (filter === "all" ? projects : projects.filter((p) => p.statusKind === filter))
    // Title AND category, because a producer looking for "the nature one" is
    // as likely to remember the kind of film as its name.
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        (p.tone ?? "").toLowerCase().includes(q),
    );

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  /**
   * Clamped at render rather than trusted from state. Filtering, searching and
   * the 15s refetch all shrink the list under a page number that was valid a
   * moment ago — and a page past the end renders as an empty library, which
   * reads as "everything is gone" rather than "you are on page 4 of 2".
   */
  const current = Math.min(Math.max(1, page), totalPages);
  const from = (current - 1) * PAGE_SIZE;
  const shown = matched.slice(from, from + PAGE_SIZE);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitManage = () => {
    setManage(false);
    setSelected(new Set());
    setArmed(false);
  };

  const onCardClick = (e: React.MouseEvent, id: string) => {
    if (manage) {
      e.preventDefault();
      toggle(id);
    }
  };

  const manageStyle = (id: string): React.CSSProperties | undefined =>
    manage
      ? {
          outline: selected.has(id)
            ? "2px solid var(--red, #d8483d)"
            : "2px solid transparent",
          opacity: selected.has(id) ? 1 : 0.75,
          transition: "outline-color 0.15s, opacity 0.15s",
        }
      : undefined;

  return (
    <>
      {/* `prow` is a modifier, not a look of its own: the projects bar
          wears the page's own typeface instead of the mono used by every
          other eyebrow. `.eyebrow` is app-wide, so this has to be scoped or
          every label on every page changes with it. */}
      <div className="eyebrow prow">
        <span>Projects</span>
        <span className="ftabs" style={{ marginLeft: 24 }}>
          {/* A tab also stays visible while it IS the active filter — the
              dashboard refetches every 15s, and a count dropping to zero must
              not strand the producer on a filter with no visible tab. */}
          {FILTERS.filter(
            (f) => f.key === "all" || (counts.get(f.key) ?? 0) > 0 || filter === f.key,
          ).map(
            (f) => (
              <button
                key={f.key}
                type="button"
                className={`ftab ${filter === f.key ? "on" : ""}`}
                onClick={() => {
                  setFilter(f.key);
                  setPage(1);
                }}
              >
                {f.label}
                <span className="c">{counts.get(f.key) ?? 0}</span>
              </button>
            ),
          )}
        </span>
        <span className="sp" />
        <span className="psearch">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search titles and themes"
            aria-label="Search projects"
            autoComplete="off"
          />
        </span>
        <span className="vtog">
          <button
            type="button"
            className={view === "grid" ? "on" : ""}
            onClick={() => pickView("grid")}
          >
            Grid
          </button>
          <button
            type="button"
            className={view === "list" ? "on" : ""}
            onClick={() => pickView("list")}
          >
            Index
          </button>
        </span>
        {/* alignSelf pulls this off the baseline: the buttons' descent would
            otherwise stretch the flex line and float the active tab's amber
            underline ~6px above the eyebrow hairline. */}
        <span style={{ display: "flex", alignItems: "center", gap: 10, alignSelf: "center" }}>
          {msg && (
            <span className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ margin: 0 }}>
              {msg.message}
            </span>
          )}
          {manage ? (
            <>
              <span style={{ fontSize: 13, color: "var(--soft)" }}>
                {selected.size} selected
              </span>
              <button
                className="abtn"
                disabled={pending || selected.size === 0}
                style={{
                  borderColor: "rgba(216, 72, 61,0.45)",
                  color: armed ? "#fff" : "var(--red)",
                  background: armed ? "rgba(216, 72, 61,0.85)" : undefined,
                  fontSize: 12,
                  padding: "7px 14px",
                }}
                onClick={() => {
                  if (!armed) {
                    setArmed(true);
                    setTimeout(() => setArmed(false), 5000);
                    return;
                  }
                  startTransition(async () => {
                    const r = await deleteProjects([...selected]);
                    setMsg(r);
                    if (r.ok) exitManage();
                    else setArmed(false);
                  });
                }}
              >
                {pending
                  ? "Deleting…"
                  : armed
                    ? `Click again — delete ${selected.size} forever`
                    : `🗑 Delete selected`}
              </button>
              <button
                className="abtn"
                style={{ fontSize: 12, padding: "7px 14px" }}
                onClick={exitManage}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="abtn"
              style={{ fontSize: 12, padding: "7px 14px" }}
              onClick={() => {
                setMsg(null);
                setManage(true);
              }}
            >
              ☑ Select
            </button>
          )}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="empty" style={{ padding: "50px 0" }}>
          <p style={{ margin: 0 }}>Nothing in this state right now.</p>
        </div>
      ) : view === "grid" ? (
        <div className="projects">
          {shown.map((p, i) => (
            <Link
              href={`/projects/${p.id}`}
              className="proj"
              key={p.id}
              onClick={(e) => onCardClick(e, p.id)}
              onMouseEnter={() => armPreview(p)}
              onMouseLeave={disarmPreview}
              style={manageStyle(p.id)}
            >
              <div className="cover">
                <div
                  className={`art ${p.coverUrl ? "" : `fallback${(i % 4) + 1}`}`}
                  style={p.coverUrl ? { backgroundImage: `url(${p.coverUrl})` } : undefined}
                />
                {/* Top-and-bottom scrim. The chips sit ON the still, and a
                    still is whatever the film generated — it can be bright,
                    pale or busy, so the chips need their own ground rather
                    than luck. */}
                <span className="scrim" aria-hidden="true" />
                {/* Re-checked at render, not just at arm time: a manage
                    toggle or the 15s refetch can invalidate a hover that
                    never got its mouseleave. */}
                {preview === p.id && canPreview(p) && (
                  <video
                    className="hoverprev"
                    src={mediaSrc(p.finalVideoUrl!)}
                    muted
                    loop
                    playsInline
                    autoPlay
                  />
                )}
                <span className={`badge ${p.statusKind === "idle" ? "run" : p.statusKind}`}>
                  {badgeLabel(p)}
                </span>
                {manage && (
                  <span
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 12,
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 15,
                      fontWeight: 700,
                      background: selected.has(p.id) ? "#d8483d" : "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.35)",
                    }}
                  >
                    {selected.has(p.id) ? "✓" : ""}
                  </span>
                )}
                <span className="rt">{runtimeOf(p.lengthSeconds)}</span>
              </div>
              <div className="body">
                <ExpandableTitle text={p.name} as="h3" clampChars={80} />
                <div className="meta">
                  {categoryLabel(p)} · {runtimeOf(p.lengthSeconds)}
                </div>
                {/* The bar and the step line belong to work in flight. On a
                    finished film a full bar says nothing the Finished chip
                    has not already said, and on an idle one it is a lie. */}
                {(p.statusKind === "run" || p.statusKind === "err") && (
                  <div className="prog">
                    <div className="track">
                      <i
                        className={p.statusKind}
                        style={{ width: `${Math.round(p.progress * 100)}%` }}
                      />
                    </div>
                    <div className="stepline">
                      <span>{p.status}</span>
                      <span>{Math.round(p.progress * 100)}%</span>
                    </div>
                  </div>
                )}
                <div className="foot">
                  <span>{agoOf(p.updatedAt) || p.status}</span>
                  <span className="go">
                    {manage
                      ? selected.has(p.id)
                        ? "Selected"
                        : "Tap to select"
                      : p.statusKind === "done"
                        ? "Watch →"
                        : "Open →"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="plist">
          {shown.map((p, i) => (
            <Link
              href={`/projects/${p.id}`}
              className="plrow"
              key={p.id}
              onClick={(e) => onCardClick(e, p.id)}
              style={manageStyle(p.id)}
            >
              <span
                className={`th ${p.coverUrl ? "" : `art fallback${(i % 4) + 1}`}`}
                style={p.coverUrl ? { backgroundImage: `url(${p.coverUrl})` } : undefined}
              >
                {manage && selected.has(p.id) && (
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(216, 72, 61,0.4)",
                      color: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                )}
              </span>
              <span style={{ minWidth: 0 }}>
                <h3>{short(p.name, 90)}</h3>
                <span className="meta">
                  {p.lengthSeconds ? `${p.lengthSeconds}s` : "—"}
                  {p.tone ? ` · ${p.tone}` : ""}
                </span>
              </span>
              <span className={`st ${p.statusKind}`}>{badgeLabel(p)}</span>
            </Link>
          ))}
        </div>
      )}

      {matched.length > 0 && (
        <div className="pshowing">
          <span>
            Showing {from + 1}–{from + shown.length} of {matched.length}
            {matched.length !== projects.length ? ` (${projects.length} total)` : ""}
          </span>
          {totalPages > 1 && (
            <nav className="pager" aria-label="Projects pages">
              <button
                type="button"
                className="pgbtn"
                onClick={() => setPage(current - 1)}
                disabled={current === 1}
              >
                ← Previous
              </button>
              <span className="pgnums">
                {pageNumbers(current, totalPages).map((n, i) =>
                  n === "gap" ? (
                    <span className="pggap" key={`gap${i}`}>
                      …
                    </span>
                  ) : (
                    <button
                      type="button"
                      key={n}
                      className={`pgnum ${n === current ? "on" : ""}`}
                      onClick={() => setPage(n)}
                      aria-current={n === current ? "page" : undefined}
                    >
                      {n}
                    </button>
                  ),
                )}
              </span>
              <button
                type="button"
                className="pgbtn"
                onClick={() => setPage(current + 1)}
                disabled={current === totalPages}
              >
                Next →
              </button>
            </nav>
          )}
        </div>
      )}
    </>
  );
}
