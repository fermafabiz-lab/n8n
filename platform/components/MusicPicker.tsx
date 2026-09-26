"use client";

/**
 * Which background track this film gets, chosen by ear.
 *
 * Final Assembly has always picked one on its own — the tone-matched
 * subfolder of Drive's `Muzica`, random within it — and the producer only
 * found out which at the end of a render. This card shows the library,
 * previews any track through the same Drive proxy the players already use,
 * and pins one as `Editing Options.musicTrack`; `Pick Music Track` in n8n
 * checks that pin FIRST, so the choice survives every re-render. Clearing
 * the pin goes back to the auto pick, which stays the default.
 *
 * A standalone self-saving card rather than a row inside FinalSettings:
 * that panel batches its choices into one confirm that also STARTS the
 * render, and a music audition must be free to happen long before anyone
 * is ready to press that.
 */

import { useEffect, useRef, useState } from "react";
import { saveMusicTrack } from "@/app/actions";
import { mediaSrc } from "@/lib/media";
import styles from "./MusicPicker.module.css";

type Track = { id: string; name: string; group: string; url?: string };

/** "atlasaudio-cinematic-softness-511863.mp3" -> "atlasaudio cinematic softness" */
function prettyName(raw: string): string {
  return raw
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s*\d{4,}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim() || raw;
}

export default function MusicPicker({
  projectId,
  current,
  musicOn,
}: {
  projectId: string;
  current: { id: string; name: string } | null;
  musicOn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // The saved pin, believed immediately on a successful save so the card
  // does not wait out the next server render to show the choice.
  const [pinned, setPinned] = useState(current);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadGroup, setUploadGroup] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // A save from another tab (or the auto pick changing server-side) wins once
  // the server confirms it; local guesses only cover the gap.
  useEffect(() => setPinned(current), [current]);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      el?.pause();
    };
  }, []);

  async function load(force = false) {
    if ((tracks && !force) || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/music", { cache: "no-store" });
      const out = (await res.json()) as { tracks?: Track[] };
      setTracks(Array.isArray(out.tracks) ? out.tracks : []);
    } catch {
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }

  function stopPreview() {
    audioRef.current?.pause();
    setPlayingId(null);
  }

  async function preview(t: Track) {
    if (playingId === t.id) {
      stopPreview();
      return;
    }
    const el = audioRef.current ?? new Audio();
    audioRef.current = el;
    el.pause();
    setPlayingId(t.id);
    try {
      // The library is on the box since 2026-09-26 (lib/music.ts): every
      // track carries its own public URL, played directly.
      el.src = mediaSrc(t.url || `https://drive.google.com/uc?export=download&id=${t.id}`);
      el.onended = () => setPlayingId((p) => (p === t.id ? null : p));
      await el.play();
    } catch {
      setPlayingId((p) => (p === t.id ? null : p));
      setNote("Nu am putut reda preview-ul — încearcă din nou.");
    }
  }

  async function choose(t: Track | null) {
    if (busy) return;
    setBusy(true);
    setNote("");
    const res = await saveMusicTrack(projectId, t ? { id: t.id, name: t.name } : null);
    setBusy(false);
    setNote(res.message);
    if (res.ok) setPinned(t ? { id: t.id, name: t.name } : null);
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setNote("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("group", uploadGroup || "Muzica");
      const res = await fetch("/api/music/upload", { method: "POST", body: form });
      const out = (await res.json()) as { ok?: boolean; message?: string; track?: Track };
      if (!out.ok) {
        setNote(out.message || "Nu am putut încărca piesa.");
        return;
      }
      setNote(`Am adăugat „${prettyName(out.track?.name || file.name)}” în ${out.track?.group || "Muzica"}.`);
      if (fileRef.current) fileRef.current.value = "";
      await load(true);
    } catch {
      setNote("Nu am putut încărca piesa — încearcă din nou.");
    } finally {
      setUploading(false);
    }
  }

  const groups = new Map<string, Track[]>();
  for (const t of tracks ?? []) {
    const g = groups.get(t.group) ?? [];
    g.push(t);
    groups.set(t.group, g);
  }

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>Muzica de fundal</div>
          <div className={styles.sub}>
            {pinned ? (
              <>Aleasă: <strong>{prettyName(pinned.name)}</strong></>
            ) : (
              <>Automată, după tonul filmului — din biblioteca de muzică.</>
            )}
            {!musicOn && (
              <span className={styles.offNote}> Muzica e oprită pentru acest film; alegerea se aude doar dacă o pornești.</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) void load();
            else stopPreview();
          }}
        >
          {open ? "Închide" : pinned ? "Schimbă melodia" : "Alege o melodie"}
        </button>
      </div>

      {open && (
        <div className={styles.body}>
          {loading && <div className={styles.hint}>Se încarcă biblioteca…</div>}
          {!loading && tracks && tracks.length === 0 && (
            <div className={styles.hint}>Biblioteca de muzică e goală — adaugă o piesă mai jos.</div>
          )}
          {!loading && tracks && tracks.length > 0 && (
            <>
              <div className={styles.row}>
                <span className={styles.autoLabel}>Automată (după ton)</span>
                {pinned ? (
                  <button type="button" className={styles.pick} disabled={busy} onClick={() => choose(null)}>
                    Revino la automat
                  </button>
                ) : (
                  <span className={styles.chosen}>✓ activă</span>
                )}
              </div>
              {[...groups.entries()].map(([group, list]) => (
                <div key={group} className={styles.group}>
                  <div className={styles.groupName}>{group}</div>
                  {list.map((t) => (
                    <div key={t.id} className={styles.row}>
                      <button
                        type="button"
                        className={styles.play}
                        onClick={() => void preview(t)}
                        aria-label={playingId === t.id ? "Oprește" : "Ascultă"}
                      >
                        {playingId === t.id ? "⏸" : "▶"}
                      </button>
                      <span className={styles.name} title={t.name}>{prettyName(t.name)}</span>
                      {pinned?.id === t.id ? (
                        <span className={styles.chosen}>✓ aleasă</span>
                      ) : (
                        <button type="button" className={styles.pick} disabled={busy} onClick={() => choose(t)}>
                          Alege
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
          {!loading && tracks && (
            <div className={styles.upload}>
              <div className={styles.groupName}>Adaugă o piesă</div>
              <div className={styles.row}>
                <input ref={fileRef} type="file" accept="audio/*" className={styles.file} disabled={uploading} />
                <input
                  list="music-groups"
                  className={styles.groupInput}
                  placeholder="Ton / grupă (ex. Epic)"
                  value={uploadGroup}
                  onChange={(e) => setUploadGroup(e.target.value)}
                  disabled={uploading}
                />
                <datalist id="music-groups">
                  {[...groups.keys()].map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
                <button type="button" className={styles.pick} disabled={uploading} onClick={() => void upload()}>
                  {uploading ? "Se încarcă…" : "Încarcă"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {note && <div className={styles.note}>{note}</div>}
    </div>
  );
}
