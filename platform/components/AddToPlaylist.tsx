"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { addToPlaylist, createPlaylist, type PlaylistResult } from "@/app/actions";
import { PLAYLIST_NAME_MAX, films, normalizePlaylistName, type Playlist } from "@/lib/playlists";
import s from "./AddToPlaylist.module.css";

/**
 * "+ Add to playlist" — the select bar's way into a playlist, for films
 * already ticked with the library's own ☑ Select.
 *
 * One panel, both roads: pick a playlist that exists, or type a name and the
 * playlist is created WITH the ticked films already in it. Each row says how
 * much of the selection it already holds, because adding five films to a
 * playlist that has three of them is a different act from adding five — and
 * one that already has all of them is disabled rather than offered as a no-op.
 */
export default function AddToPlaylist({
  playlists,
  selected,
  disabled,
  onDone,
}: {
  playlists: Playlist[];
  /** The ticked films' ids. */
  selected: string[];
  disabled?: boolean;
  /** A write landed; `name` is the playlist it went into. */
  onDone: (r: PlaylistResult, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /**
   * Where the panel sits, in px from the button's left edge — measured, not
   * assumed. The select bar's row is a function of the data and WRAPS (at
   * 1280, 1440 and 1600 alike it is two rows in select mode), so this button
   * can land at the far left of a row, where a panel hung from its right edge
   * opened 40px off the screen with the playlist names cut in half. So: line
   * the panel's right edge up with the button's when there is room, and slide
   * it just far enough to stay 16px inside the viewport when there is not.
   * Measured before paint (layout effect), so it never flashes in the wrong
   * place. `position: fixed` is not an option: the toolbar has a
   * backdrop-filter, which makes it the containing block for fixed children.
   */
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = root.current?.getBoundingClientRect();
      const width = panel.current?.offsetWidth;
      if (!button || !width) return;
      const EDGE = 16;
      const viewport = document.documentElement.clientWidth;
      const at = Math.min(Math.max(button.right - width, EDGE), viewport - EDGE - width);
      setLeft(at - button.left);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // Closes on a click anywhere else and on Escape — a panel you have to find
  // the button again to dismiss is a panel people leave open over the cards.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing ticked, nothing to add: the panel closes rather than offering it.
  useEffect(() => {
    if (selected.length === 0) setOpen(false);
  }, [selected.length]);

  const add = (p: Playlist) => {
    setError("");
    startTransition(async () => {
      const r = await addToPlaylist(p.id, selected);
      if (!r.ok) return setError(r.message);
      setOpen(false);
      onDone(r, p.name);
    });
  };

  const create = () => {
    const check = normalizePlaylistName(draft);
    if (!check.ok) return setError(check.message);
    const clash = playlists.find((p) => p.name.toLocaleLowerCase() === check.name.toLocaleLowerCase());
    if (clash) return setError(`There is already a playlist called “${clash.name}” — pick it above.`);
    setError("");
    startTransition(async () => {
      const r = await createPlaylist(check.name, selected);
      if (!r.ok) return setError(r.message);
      setDraft("");
      setOpen(false);
      onDone(r, check.name);
    });
  };

  return (
    <span className={s.root} ref={root}>
      <button
        type="button"
        className="abtn"
        style={{ fontSize: 12, padding: "7px 14px" }}
        disabled={disabled || selected.length === 0}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setError("");
          setOpen((o) => !o);
        }}
      >
        ＋ Add to playlist
      </button>
      {open && (
        <div
          ref={panel}
          className={s.pop}
          role="dialog"
          aria-label="Add to a playlist"
          style={left === null ? undefined : { left, right: "auto" }}
        >
          <div className={s.head}>Add {films(selected.length)} to…</div>
          {playlists.length > 0 && (
            <>
              <ul className={s.list}>
                {playlists.map((p) => {
                  const inIt = new Set(p.projectIds);
                  const has = selected.filter((id) => inIt.has(id)).length;
                  const all = has === selected.length;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={s.item}
                        disabled={pending || all}
                        onClick={() => add(p)}
                        title={p.name}
                      >
                        <span className={s.itemName}>{p.name}</span>
                        <span className={s.itemNote}>
                          {all
                            ? selected.length === 1
                              ? "already in it"
                              : "has them all"
                            : has > 0
                              ? `has ${has} of ${selected.length}`
                              : films(p.projectIds.length)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className={s.sep} />
            </>
          )}
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              className={s.input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={playlists.length > 0 ? "…or a new playlist" : "Name the new playlist"}
              aria-label="New playlist name"
              maxLength={PLAYLIST_NAME_MAX}
              autoComplete="off"
              autoFocus={playlists.length === 0}
              disabled={pending}
            />
            <button type="submit" className={s.create} disabled={pending || !draft.trim()}>
              {pending ? "Saving…" : "Create"}
            </button>
          </form>
          {error && (
            <p className={s.err} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
