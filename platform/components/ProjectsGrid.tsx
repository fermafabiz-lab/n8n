"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  addToPlaylist,
  deleteProjects,
  removeFromPlaylist,
  type ActionResult,
  type PlaylistResult,
} from "@/app/actions";
import ExpandableTitle from "@/components/ExpandableTitle";
import PlaylistBar from "@/components/PlaylistBar";
import AddToPlaylist from "@/components/AddToPlaylist";
import { films, sortPlaylists, type Playlist } from "@/lib/playlists";
import { CATEGORIES } from "@/lib/categories";
import { categoryLists, isCategoryListId, resolveCategoryList } from "@/lib/category-lists";
import { orderLibrary, type LibraryOrder } from "@/lib/library-order";
import type { Project, StatusKind } from "@/lib/data";
import { LIBRARY_FILTERS as FILTERS, isFilterKey, type FilterKey } from "@/lib/library-filters";
import { CREATORS } from "@/lib/data/derive";
import { mediaSrc } from "@/lib/media";

function badgeLabel(p: Project): string {
  switch (p.statusKind) {
    case "wait":
      return "Needs review";
    case "run":
      return "Rendering";
    case "done":
      // On a delivered film, the interesting state is no longer the
      // pipeline's — it is the film's own way to YouTube. One badge slot,
      // so the publishing state takes it over once it says something.
      return p.publishing.state === "posted"
        ? "Posted"
        : p.publishing.state === "ready"
          ? "Ready to post"
          : "Finished";
    case "err":
      return "Needs a fix";
    default:
      return p.status;
  }
}

/** The badge's colour class — publishing gets its own on finished films. */
function badgeClass(p: Project): string {
  if (p.statusKind === "idle") return "run";
  if (p.statusKind === "done" && p.publishing.state === "ready") return "ready";
  return p.statusKind;
}

/**
 * Every status a card can wear must have a tab, or its projects are counted
 * in "All" and reachable from nowhere — the fault the "Other" tab was added
 * to cure. The list moved to lib/library-filters.ts so a link can be checked
 * against it; this keeps the tie to StatusKind that the old local type had.
 */
type _EveryKindHasATab = Exclude<StatusKind, FilterKey> extends never ? true : never;
const _everyKindHasATab: _EveryKindHasATab = true;
void _everyKindHasATab;

const isToPost = (p: Project) =>
  p.statusKind === "done" && p.publishing.state === "ready";

const short = (s: string, n: number) =>
  s.length > n ? s.slice(0, n).trimEnd() + "…" : s;

/**
 * The toolbar (.eyebrow.prow) sets everything in it in capitals with 0.14em
 * tracking — right for its own labels, wrong for a playlist name, which is
 * the producer's own words: "iPhone stories" is not "IPHONE STORIES".
 * Buttons are safe already (the browser's own stylesheet gives every
 * <button> `text-transform: none`, measured), but the result line is a plain
 * <span> and inherits the capitals — so it opts out, and a sentence reads as
 * one rather than as a label.
 */
const ASIS: React.CSSProperties = { textTransform: "none", letterSpacing: "normal" };

/**
 * Dashboard projects: filter tabs (a hundred projects is a wall without
 * them), a grid/index view toggle — the index being the editorial list that
 * makes that wall scannable — and a manage mode where Select turns entries
 * into checkboxes and a two-step Delete removes every selected project
 * (scenes + scripts + project record; Drive media stays).
 *
 * Above the toolbar sits the playlist row (PlaylistBar): the producer's own
 * named sets of films, one chip each. Choosing one narrows everything below
 * it; the same Select fills and empties them ("Add to playlist" / "Remove
 * from"), and neither of those can ever delete a film.
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

/**
 * A result line in the toolbar, optionally with the one thing worth doing
 * next — "Undo" after films leave a playlist, "Open" after they join one.
 */
type LibraryMsg = ActionResult & { action?: { label: string; run: () => void } };

export default function ProjectsGrid({
  projects,
  playlists,
  order = "activity",
}: {
  /** In the server's creation order, newest first. */
  projects: Project[];
  /** Null when they could not be read — the library still works without
   *  them, it just cannot offer them (see app/projects/page.tsx). */
  playlists: Playlist[] | null;
  /** Recently worked on, or Newest first — per device, Settings → Customize
   *  (lib/library-order.ts). */
  order?: LibraryOrder;
}) {
  const [manage, setManage] = useState(false);
  /**
   * The pointer is over the cards. While it is — or while Select is on —
   * the order holds still (orderLibrary's `hold`): with the pipeline counting
   * as activity a film can rise at any refresh, and a card that moves under a
   * click opens or ticks the wrong film.
   */
  const [pointing, setPointing] = useState(false);
  const shownOrder = useRef<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<LibraryMsg | null>(null);
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterKey>("all");
  /**
   * The playlists as this page last knew them. A copy of the prop rather than
   * the prop itself so a write shows at once, before the refresh that
   * follows it lands — and reset from the prop on every refresh, so the
   * server's answer always has the last word (another tab, another person).
   */
  const [pls, setPls] = useState<Playlist[] | null>(playlists);
  useEffect(() => setPls(playlists), [playlists]);
  /**
   * The playlist on screen, from `?playlist=` — the same arrangement as the
   * tabs' `?filter=` below, and for the same reasons: a playlist can be
   * linked to, and the 15s refresh must not drop the producer back to All.
   * Held as whatever the URL said, valid or not: a link to a playlist that
   * has since been deleted must SAY so rather than quietly show everything.
   */
  const [listId, setListId] = useState<string | null>(null);
  const selfSetList = useRef(false);
  /**
   * Select mode with a destination already chosen: set by "+ New playlist"
   * (and by an empty playlist's "Add films"). The select bar then offers one
   * thing — "Add N to <it>" — instead of the menu, because the question the
   * menu asks has just been answered.
   */
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  /**
   * The chosen tab lives in the URL, which is what makes it linkable.
   *
   * It did not, and that is why the hero's "Everything waiting on me" was a
   * dead button: it pointed at `/projects?filter=wait` and NOTHING read that
   * param — the tab was `useState("all")` and nothing else, so the link
   * changed the address bar and not one pixel of the page. Reading it is the
   * fix. Writing it back on every tab click is what keeps the two from
   * drifting apart, and it also cures a smaller bug nobody had reported: the
   * 15s refresh used to drop the chosen tab back to All.
   *
   * `useSearchParams` rather than a mount-time read of `location`, because
   * the hero link goes from /projects to /projects — a soft navigation that
   * leaves this component mounted, so an effect that only ran on mount would
   * never fire and the button would still do nothing.
   */
  const searchParams = useSearchParams();
  const urlFilter = searchParams.get("filter");
  const urlPlaylist = searchParams.get("playlist");
  /** Set by our own tab clicks, so they do not count as "take me there". */
  const selfSet = useRef(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  /** Filters title and category live, exactly as the design's search does. */
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  /**
   * Paging scrolls the list back to its head. Without this a page change
   * lands you at the BOTTOM of the new page — the new cards render into the
   * same scroll position the old ones held, and "Next" reads as having
   * jumped to the end of something. Only the pager sets the flag: a filter
   * or a search also resets to page 1, and yanking the viewport while
   * someone is typing would be worse than the thing this fixes.
   */
  const headRef = useRef<HTMLDivElement>(null);
  const scrollOnPage = useRef(false);
  const goPage = (n: number) => {
    scrollOnPage.current = true;
    setPage(n);
  };
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

  /*
   * The playlist narrows the library FIRST, and everything below — the tab
   * counts, the search, the pages, the per-person score — answers inside it.
   * So "Needs you 2" on a playlist means two films in THAT playlist need you,
   * which is the question somebody looking at a playlist is asking.
   *
   * A chip's count is taken against the same library the grid holds rather
   * than read off the playlist, so the number on the chip is always the
   * number of cards it opens to.
   */
  const libraryIds = new Set(projects.map((p) => p.id));
  const listCounts = new Map(
    (pls ?? []).map((pl) => [pl.id, pl.projectIds.filter((id) => libraryIds.has(id)).length] as const),
  );
  /*
   * The site's own lists, one per category with a film (lib/category-lists.ts)
   * — derived from the library on every render, so there is nothing to keep
   * in step and a new film is in its category the moment it exists. They open
   * exactly like a playlist (`?playlist=category:<id>`), which is what lets
   * every line below serve both without knowing the difference; only the
   * lines that WRITE a playlist — Remove, Rename, Delete, "Add films to it" —
   * check which kind is open.
   */
  const catLists = categoryLists(projects, CATEGORIES);
  const activeCategory = isCategoryListId(listId) ? resolveCategoryList(listId, projects, CATEGORIES) : null;
  const active: Playlist | null = isCategoryListId(listId)
    ? activeCategory
    : listId
      ? (pls?.find((pl) => pl.id === listId) ?? null)
      : null;
  // A category list is never unreadable, so an unknown one is stale even
  // while the producer's playlists could not be loaded.
  const staleList = listId !== null && active === null && (pls !== null || isCategoryListId(listId));
  const inActive = active ? new Set(active.projectIds) : null;
  // The whole library in the chosen order, BEFORE any scoping — so the same
  // order carries into playlists, tabs, search and pages (the producer's
  // answer: "the same everywhere"). Held still while pointing or selecting.
  const holding = pointing || manage;
  const ordered = orderLibrary(projects, order, holding ? shownOrder.current : null);
  useEffect(() => {
    shownOrder.current = ordered.map((p) => p.id);
  });
  const scoped = inActive ? ordered.filter((p) => inActive.has(p.id)) : ordered;

  const counts = new Map<string, number>([["all", scoped.length]]);
  for (const p of scoped) counts.set(p.statusKind, (counts.get(p.statusKind) ?? 0) + 1);
  counts.set("topost", scoped.filter(isToPost).length);
  const q = query.trim().toLowerCase();
  const matched = (filter === "all"
    ? scoped
    : filter === "topost"
      ? scoped.filter(isToPost)
      : scoped.filter((p) => p.statusKind === filter))
    // Title AND category, because a producer looking for "the nature one" is
    // as likely to remember the kind of film as its name.
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        (p.tone ?? "").toLowerCase().includes(q),
    );

  // The score. Counted over the MATCHED set rather than the whole library, so
  // it answers whatever question the tabs and the search are already asking —
  // "who has films in flight", "who made the finished ones" — instead of one
  // fixed total. Films from before the name existed are counted apart rather
  // than hidden: a tally that silently drops rows reads as a wrong count.
  const byCreator = CREATORS.map((who) => ({
    who,
    n: matched.filter((p) => p.createdBy === who).length,
  })).filter((c) => c.n > 0);
  const unattributed = matched.filter((p) => !p.createdBy).length;

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  /**
   * Clamped at render rather than trusted from state. Filtering, searching and
   * the 15s refetch all shrink the list under a page number that was valid a
   * moment ago — and a page past the end renders as an empty library, which
   * reads as "everything is gone" rather than "you are on page 4 of 2".
   */
  const current = Math.min(Math.max(1, page), totalPages);
  useEffect(() => {
    if (!scrollOnPage.current) return;
    scrollOnPage.current = false;
    // scroll-margin-top on the toolbar keeps it clear of the sticky nav.
    headRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [current]);
  const from = (current - 1) * PAGE_SIZE;
  const shown = matched.slice(from, from + PAGE_SIZE);

  useEffect(() => {
    if (!isFilterKey(urlFilter)) return;
    setFilter(urlFilter);
    setPage(1);
    // Someone ASKED for this list, and it sits below the fold from the hero
    // — which is the other half of why that button read as doing nothing.
    // A tab clicked here writes the same param, so it is flagged first: the
    // producer is already looking at the list and yanking the viewport for
    // them would be its own bug.
    if (selfSet.current) {
      selfSet.current = false;
      return;
    }
    headRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [urlFilter]);

  /**
   * Choose a tab, and say so in the URL — with `history.replaceState`, never
   * a router navigation: this page is `force-dynamic`, so a real navigation
   * would re-read every project from Postgres to change a filter that is
   * applied entirely in the browser.
   */
  const chooseFilter = (key: FilterKey) => {
    setFilter(key);
    setPage(1);
    selfSet.current = true;
    try {
      const url = new URL(window.location.href);
      if (key === "all") url.searchParams.delete("filter");
      else url.searchParams.set("filter", key);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      selfSet.current = false;
    }
  };

  // The playlist follows the address the same way the tab does. A missing
  // param means the whole library — so the hero's "See all N" link, which
  // names only a filter, also leaves whatever playlist was open.
  useEffect(() => {
    setListId(urlPlaylist || null);
    setPage(1);
    if (selfSetList.current) {
      selfSetList.current = false;
      return;
    }
    if (urlPlaylist) headRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [urlPlaylist]);

  /** Open a playlist (or the whole library), and say so in the URL. */
  const choosePlaylist = (id: string | null) => {
    setListId(id);
    setPage(1);
    try {
      const url = new URL(window.location.href);
      // Flag only a change the effect will actually see — a flag left up by
      // a no-op would swallow the scroll of the next real link.
      if (url.searchParams.get("playlist") !== id) selfSetList.current = true;
      if (id) url.searchParams.set("playlist", id);
      else url.searchParams.delete("playlist");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      selfSetList.current = false;
    }
  };

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
    setTarget(null);
  };

  /** Put films into a playlist in the local copy — new playlist or old. */
  const patchAdd = (id: string, name: string, ids: string[]) =>
    setPls((prev) => {
      const list = prev ?? [];
      const known = list.some((pl) => pl.id === id);
      return sortPlaylists(
        known
          ? list.map((pl) =>
              pl.id === id ? { ...pl, projectIds: [...new Set([...pl.projectIds, ...ids])] } : pl,
            )
          : [...list, { id, name, projectIds: ids }],
      );
    });

  /** The select bar's menu landed films in a playlist (maybe a new one). */
  const onAddedToPlaylist = (r: PlaylistResult, name: string) => {
    const ids = [...selected];
    if (r.playlistId) patchAdd(r.playlistId, name, ids);
    exitManage();
    const where = r.playlistId;
    setMsg({
      ...r,
      // Offered only when the films went somewhere other than the screen.
      action:
        where && where !== listId
          ? { label: `Open “${short(name, 24)}”`, run: () => (choosePlaylist(where), setMsg(null)) }
          : undefined,
    });
  };

  /** "+ Add N to <target>" — the second half of "+ New playlist". */
  const addToTarget = () => {
    if (!target) return;
    const t = target;
    const ids = [...selected];
    startTransition(async () => {
      const r = await addToPlaylist(t.id, ids);
      if (!r.ok) {
        setMsg(r);
        return;
      }
      patchAdd(t.id, t.name, ids);
      exitManage();
      // Straight to the result: the playlist the producer just made, full.
      choosePlaylist(t.id);
      setMsg(r);
    });
  };

  /** Start filling a playlist: the whole library, select mode, target set.
   *  An empty playlist cannot be filled from inside itself — the films to
   *  choose from are out in the library. */
  const startFilling = (pl: { id: string; name: string }, justCreated = false) => {
    choosePlaylist(null);
    setTarget(pl);
    setManage(true);
    setSelected(new Set());
    setArmed(false);
    // Short on purpose: this line rides in the sticky toolbar while the
    // producer scrolls through the cards, next to a button that already
    // names the playlist.
    setMsg({
      ok: true,
      message: justCreated
        ? `Created “${pl.name}” — now tick the films to put in it.`
        : `Tick the films to put in “${pl.name}”.`,
    });
  };

  /** Take the ticked films out of the playlist on screen — never out of
   *  the library. Offers Undo, because it is one click with no arming. */
  const removeFromActive = () => {
    // A film leaves a category by being filed as another kind, in its brief —
    // never from here.
    if (!active || activeCategory) return;
    const pl = { id: active.id, name: active.name };
    const ids = [...selected];
    startTransition(async () => {
      const r = await removeFromPlaylist(pl.id, ids);
      if (!r.ok) {
        setMsg(r);
        return;
      }
      const gone = r.removed ?? [];
      const out = new Set(gone);
      setPls((prev) =>
        prev
          ? prev.map((p) => (p.id === pl.id ? { ...p, projectIds: p.projectIds.filter((id) => !out.has(id)) } : p))
          : prev,
      );
      exitManage();
      setMsg({
        ...r,
        action: gone.length > 0 ? { label: "Undo", run: () => putBack(pl, gone) } : undefined,
      });
    });
  };

  const putBack = (pl: { id: string; name: string }, ids: string[]) => {
    startTransition(async () => {
      const r = await addToPlaylist(pl.id, ids);
      if (r.ok) patchAdd(pl.id, pl.name, ids);
      setMsg(r.ok ? { ok: true, message: `Put ${films(ids.length)} back in “${pl.name}”.` } : r);
    });
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
      {pls === null ? (
        // Unreadable is said, not hidden: a row that silently vanished would
        // read as the playlists having been deleted.
        <p style={{ margin: "22px 4px 0", fontSize: 12.5, color: "var(--dim)" }}>
          Playlists could not be loaded just now — the library below is complete.
        </p>
      ) : (
        <PlaylistBar
          playlists={pls}
          categories={catLists}
          counts={listCounts}
          active={active}
          stale={staleList}
          total={projects.length}
          onChoose={(id) => {
            setMsg(null);
            choosePlaylist(id);
          }}
          onCreated={(pl) => {
            patchAdd(pl.id, pl.name, []);
            startFilling(pl, true);
          }}
          onRenamed={(id, name, message) => {
            setPls((prev) => (prev ? sortPlaylists(prev.map((p) => (p.id === id ? { ...p, name } : p))) : prev));
            if (target?.id === id) setTarget({ id, name });
            setMsg({ ok: true, message });
          }}
          onDeleted={(id, message) => {
            setPls((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
            if (target?.id === id) exitManage();
            choosePlaylist(null);
            setMsg({ ok: true, message });
          }}
        />
      )}
      {/* `prow` is a modifier, not a look of its own: the projects bar
          wears the page's own typeface instead of the mono used by every
          other eyebrow. `.eyebrow` is app-wide, so this has to be scoped or
          every label on every page changes with it. */}
      <div className="eyebrow prow" ref={headRef}>
        <span className="plabel">Projects</span>
        <span className="ftabs">
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
                onClick={() => chooseFilter(f.key)}
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
            underline ~6px above the eyebrow hairline.

            It WRAPS, since the playlists: inside a playlist the select bar
            holds five things (count, Add to playlist, Remove from, Delete,
            Cancel), and on a 390px phone they ran to x=464 — Cancel off the
            screen, the page scrolling sideways. Measured, not guessed; only a
            row that does not fit ever wraps, so a laptop sees no change. */}
        <span className="ptools" style={{ flexWrap: "wrap", justifyContent: "flex-end", rowGap: 8 }}>
          {msg && (
            <span className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ margin: 0, ...ASIS }}>
              {msg.message}
              {msg.action && (
                <button
                  type="button"
                  onClick={msg.action.run}
                  style={{
                    marginLeft: 10,
                    font: "inherit",
                    fontWeight: 700,
                    color: "inherit",
                    background: "none",
                    border: "none",
                    padding: 0,
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                    cursor: "pointer",
                  }}
                >
                  {msg.action.label}
                </button>
              )}
            </span>
          )}
          {manage ? (
            <>
              <span style={{ fontSize: 13, color: "var(--soft)" }}>
                {selected.size} selected
              </span>
              {target ? (
                // "+ New playlist" already chose where these go, so the one
                // action left is to send them — nothing else competes with it,
                // Delete least of all.
                <button
                  className="abtn ok"
                  disabled={pending || selected.size === 0}
                  style={{ fontSize: 12, padding: "7px 14px" }}
                  onClick={addToTarget}
                >
                  {pending ? (
                    "Adding…"
                  ) : (
                    <>
                      ＋ Add {selected.size > 0 ? `${selected.size} ` : ""}to{" "}
                      “{short(target.name, 28)}”
                    </>
                  )}
                </button>
              ) : (
                <>
                  {pls && (
                    <AddToPlaylist
                      playlists={pls}
                      selected={[...selected]}
                      disabled={pending}
                      onDone={onAddedToPlaylist}
                    />
                  )}
                  {active && !activeCategory && (
                    <button
                      className="abtn"
                      disabled={pending || selected.size === 0}
                      style={{ fontSize: 12, padding: "7px 14px" }}
                      onClick={removeFromActive}
                      title="Takes the ticked films out of this playlist. They stay in the library."
                    >
                      − Remove from “{short(active.name, 24)}”
                    </button>
                  )}
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
                    {/* Inside a playlist "Delete" sits next to "Remove", and
                        the two must never be confused: this one deletes the
                        FILMS, from everywhere, for good. So it says so. */}
                    {pending
                      ? "Deleting…"
                      : armed
                        ? active
                          ? `Click again — delete ${selected.size} from the whole library, forever`
                          : `Click again — delete ${selected.size} forever`
                        : active
                          ? "🗑 Delete films"
                          : "🗑 Delete selected"}
                  </button>
                </>
              )}
              <button
                className="abtn"
                style={{ fontSize: 12, padding: "7px 14px" }}
                onClick={() => {
                  // Leaving "fill the new playlist" with nothing in it leaves
                  // an empty playlist behind — say where it is, not nothing.
                  if (target) {
                    setMsg({
                      ok: true,
                      message: `“${target.name}” is empty for now — tick films and use Add to playlist any time.`,
                    });
                  }
                  exitManage();
                }}
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
        activeCategory && scoped.length === 0 ? (
          // Reachable only by an old link: a category with no films has no
          // chip. Nothing to fill — a film joins by being made as one.
          <div className="empty" style={{ padding: "50px 0" }}>
            <p style={{ margin: 0 }}>No {activeCategory.name} films yet.</p>
          </div>
        ) : active && scoped.length === 0 ? (
          // An empty playlist is not "nothing in this state": it is a
          // playlist waiting for its first films, and the way to add them
          // should be right here rather than a Select-and-menu away.
          <div className="empty" style={{ padding: "50px 0" }}>
            <p style={{ margin: "0 0 16px" }}>“{active.name}” has no films yet.</p>
            {!manage && (
              <button
                className="abtn ok"
                style={{ fontSize: 13, padding: "9px 18px" }}
                onClick={() => startFilling({ id: active.id, name: active.name })}
              >
                ＋ Add films to it
              </button>
            )}
          </div>
        ) : (
          <div className="empty" style={{ padding: "50px 0" }}>
            <p style={{ margin: 0 }}>Nothing in this state right now.</p>
          </div>
        )
      ) : view === "grid" ? (
        <div className="projects" onPointerEnter={() => setPointing(true)} onPointerLeave={() => setPointing(false)} data-holding={holding ? "" : undefined}>
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
                <span className={`badge ${badgeClass(p)}`}>
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
                  {/* Who made it, on the card itself — the whole point of
                      recording the name. Older films have none and simply
                      show the time, exactly as they did before. */}
                  <span>
                    {p.createdBy ? `${p.createdBy} · ` : ""}
                    {/* The time the ORDER uses, or the list would look
                        shuffled: sorted by last change but labelled with
                        creation, the top card could read "3 days ago" above
                        one that reads "2 min ago". */}
                    {order === "activity"
                      ? agoOf(p.activityAt)
                        ? `updated ${agoOf(p.activityAt)}`
                        : p.status
                      : agoOf(p.updatedAt) || p.status}
                  </span>
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
        <div className="plist" onPointerEnter={() => setPointing(true)} onPointerLeave={() => setPointing(false)} data-holding={holding ? "" : undefined}>
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
                  {p.createdBy ? ` · ${p.createdBy}` : ""}
                </span>
              </span>
              <span className={`st ${badgeClass(p)}`}>{badgeLabel(p)}</span>
            </Link>
          ))}
        </div>
      )}

      {matched.length > 0 && (
        <div className="pshowing">
          <span>
            Showing {from + 1}–{from + shown.length} of {matched.length}
            {active ? ` in “${short(active.name, 32)}”` : ""}
            {matched.length !== scoped.length
              ? ` (${scoped.length} ${active ? (activeCategory ? `in ${activeCategory.name}` : "in the playlist") : "total"})`
              : ""}
          </span>
          {/* Who made what, for the set on screen. Absent entirely until at
              least one film carries a name, so a library of older projects
              gains no empty row. */}
          {byCreator.length > 0 && (
            <span style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--soft)" }}>
              {byCreator.map((c) => (
                <span key={c.who}>
                  {c.who} <b style={{ color: "var(--ink)" }}>{c.n}</b>
                </span>
              ))}
              {unattributed > 0 && <span>unnamed {unattributed}</span>}
            </span>
          )}
          {totalPages > 1 && (
            <nav className="pager" aria-label="Projects pages">
              <button
                type="button"
                className="pgbtn"
                onClick={() => goPage(current - 1)}
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
                      onClick={() => goPage(n)}
                      aria-current={n === current ? "page" : undefined}
                    >
                      {n}
                    </button>
                  ),
                )}
              </span>
              {/* Phone only: the numbers are hidden there, and Previous /
                  Next alone never say where you are. */}
              <span className="pgcur">
                Page {current} of {totalPages}
              </span>
              <button
                type="button"
                className="pgbtn"
                onClick={() => goPage(current + 1)}
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
