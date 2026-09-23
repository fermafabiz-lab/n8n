"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPlaylist, deletePlaylist, renamePlaylist } from "@/app/actions";
import { isCategoryListId, type CategoryList } from "@/lib/category-lists";
import { PLAYLIST_NAME_MAX, films, normalizePlaylistName, type Playlist } from "@/lib/playlists";
import s from "./PlaylistBar.module.css";

/**
 * The playlist row above the library toolbar: every playlist as a chip with
 * its count, "All films" to leave them, "+ New playlist", and — for the one
 * on screen — Rename and Delete.
 *
 * Before the producer's own playlists come the CATEGORY chips (Story,
 * Documentary, …; lib/category-lists.ts): one per category that has a film,
 * kept by the site, marked with the category's icon, and never renamed or
 * deleted — so the tools below simply do not appear for them.
 *
 * It owns only its own typing and arming. Which playlist is open, what is
 * selected and what the message says all live in ProjectsGrid, which is the
 * one place that knows about the select bar too — because creating a
 * playlist here hands straight over to it: the new playlist is empty, so the
 * next thing the producer does is tick films, and that is the grid's job.
 */
export default function PlaylistBar({
  playlists,
  categories,
  counts,
  active,
  stale,
  total,
  onChoose,
  onCreated,
  onRenamed,
  onDeleted,
}: {
  /** Already in chip order (sortPlaylists). */
  playlists: Playlist[];
  /** The categories that have films, in the brief's order (categoryLists). */
  categories: CategoryList[];
  /** Films per playlist, counted against the library the grid holds — so a
   *  chip's number is always the number of cards it opens to. */
  counts: Map<string, number>;
  /** The playlist on screen — the producer's own or a category's — or null
   *  for the whole library. */
  active: Playlist | null;
  /** The address named a playlist that no longer exists. */
  stale: boolean;
  /** Films in the library, for the "All films" chip. */
  total: number;
  onChoose: (id: string | null) => void;
  onCreated: (pl: { id: string; name: string }, message: string) => void;
  onRenamed: (id: string, name: string, message: string) => void;
  onDeleted: (id: string, message: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // Rename and Delete belong to the producer's own playlists only — a
  // category list is the site's, and there is nothing of it to rename.
  const own = active !== null && !isCategoryListId(active.id) ? active : null;

  // Whatever was half-done belongs to the playlist it was started on.
  useEffect(() => {
    setRenaming(false);
    setArmed(false);
    setError("");
  }, [active?.id]);

  // A second name that differs only in case is refused by the database; say
  // so before the round trip, from the list already on screen.
  const takenBy = (name: string, except?: string) =>
    playlists.find((p) => p.id !== except && p.name.toLocaleLowerCase() === name.toLocaleLowerCase());

  const create = (raw: string) => {
    const check = normalizePlaylistName(raw);
    if (!check.ok) return setError(check.message);
    const clash = takenBy(check.name);
    if (clash) return setError(`There is already a playlist called “${clash.name}” — pick it above.`);
    setError("");
    startTransition(async () => {
      const r = await createPlaylist(check.name);
      if (!r.ok || !r.playlistId) return setError(r.message);
      setCreating(false);
      onCreated({ id: r.playlistId, name: check.name }, r.message);
    });
  };

  const rename = (raw: string) => {
    if (!own) return;
    const check = normalizePlaylistName(raw);
    if (!check.ok) return setError(check.message);
    if (check.name === own.name) {
      setRenaming(false);
      return setError("");
    }
    const clash = takenBy(check.name, own.id);
    if (clash) return setError(`There is already a playlist called “${clash.name}”.`);
    setError("");
    const id = own.id;
    startTransition(async () => {
      const r = await renamePlaylist(id, check.name);
      if (!r.ok) return setError(r.message);
      setRenaming(false);
      onRenamed(id, check.name, r.message);
    });
  };

  const remove = () => {
    if (!own) return;
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 5000);
      return;
    }
    const id = own.id;
    startTransition(async () => {
      const r = await deletePlaylist(id);
      setArmed(false);
      if (!r.ok) return setError(r.message);
      onDeleted(id, r.message);
    });
  };

  const activeCount = own ? (counts.get(own.id) ?? 0) : 0;

  return (
    <div className={s.bar} role="group" aria-label="Playlists">
      <span className={s.label}>Playlists</span>

      {/* With no chips there is nothing to switch between, so "All films"
          would be a chip that is always on and does nothing. */}
      {(playlists.length > 0 || categories.length > 0) && (
        <button
          type="button"
          className={`${s.chip} ${active === null ? s.on : ""}`}
          aria-pressed={active === null}
          onClick={() => onChoose(null)}
        >
          <span className={s.name}>All films</span>
          <span className={s.count}>{total}</span>
        </button>
      )}

      {categories.map((c) => (
        <button
          type="button"
          key={c.id}
          className={`${s.chip} ${s.cat} ${active?.id === c.id ? s.on : ""}`}
          aria-pressed={active?.id === c.id}
          title={`Every ${c.name} film — kept up to date by the site`}
          onClick={() => onChoose(active?.id === c.id ? null : c.id)}
        >
          <span className={s.icon} aria-hidden="true">
            {c.icon}
          </span>
          <span className={s.name}>{c.name}</span>
          <span className={s.count}>{c.projectIds.length}</span>
        </button>
      ))}
      {/* The line between the site's lists and the producer's own. */}
      {categories.length > 0 && playlists.length > 0 && <span className={s.sep} aria-hidden="true" />}

      {playlists.map((p) =>
        renaming && active?.id === p.id ? (
          <NameForm
            key={p.id}
            initial={p.name}
            submitLabel="Save"
            pending={pending}
            onSubmit={rename}
            onCancel={() => {
              setRenaming(false);
              setError("");
            }}
          />
        ) : (
          <button
            type="button"
            key={p.id}
            className={`${s.chip} ${active?.id === p.id ? s.on : ""}`}
            aria-pressed={active?.id === p.id}
            title={p.name}
            onClick={() => onChoose(active?.id === p.id ? null : p.id)}
          >
            <span className={s.name}>{p.name}</span>
            <span className={s.count}>{counts.get(p.id) ?? 0}</span>
          </button>
        ),
      )}

      {creating ? (
        <NameForm
          initial=""
          placeholder="Name the playlist"
          submitLabel="Create"
          pending={pending}
          onSubmit={create}
          onCancel={() => {
            setCreating(false);
            setError("");
          }}
        />
      ) : (
        <button
          type="button"
          className={s.newBtn}
          onClick={() => {
            setRenaming(false);
            setCreating(true);
            setError("");
          }}
        >
          ＋ New playlist
        </button>
      )}

      {playlists.length === 0 && !creating && (
        <span className={s.hint}>Name one, then tick the films to put in it.</span>
      )}

      {own && !renaming && (
        <span className={s.tools}>
          <button
            type="button"
            className={s.link}
            onClick={() => {
              setCreating(false);
              setRenaming(true);
              setError("");
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className={armed ? s.armed : s.danger}
            disabled={pending}
            onClick={remove}
            title="Deletes the playlist only — every film in it stays in the library."
          >
            {pending && armed
              ? "Deleting…"
              : armed
                ? activeCount > 0
                  ? `Click again — delete the playlist (its ${films(activeCount)} stay)`
                  : "Click again — delete the empty playlist"
                : "Delete playlist"}
          </button>
        </span>
      )}

      {stale && !error && (
        <span className={s.err}>That playlist no longer exists — showing all films.</span>
      )}
      {error && (
        <span className={s.err} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The one inline name field, for "+ New playlist" and for Rename. Enter
 * submits, Escape cancels, and it opens focused — with the old name selected
 * when renaming, so typing replaces it and an arrow key edits it.
 */
function NameForm({
  initial,
  placeholder,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <input
        ref={ref}
        className={s.input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        maxLength={PLAYLIST_NAME_MAX}
        aria-label={placeholder ?? "Playlist name"}
        autoComplete="off"
        disabled={pending}
      />
      <button type="submit" className={s.primary} disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
      <button type="button" className={s.small} onClick={onCancel} disabled={pending}>
        Cancel
      </button>
    </form>
  );
}
