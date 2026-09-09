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

type Track = { id: string; name: string; group: string };

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
  // Share is idempotent but still a Drive write — remember who already got one.
  const sharedRef = useRef<Set<string>>(new Set());

  // A save from another tab (or the auto pick changing server-side) wins once
  // the server confirms it; local guesses only cover the gap.
  useEffect(() => setPinned(current), [current]);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      el?.pause();
    };
  }, []);

  async function load() {
    if (tracks || loading) return;
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
      if (!sharedRef.current.has(t.id)) {
        // Make the file link-readable first — /api/media fetches Drive with
        // no session, so an unshared file answers HTML and the play fails.
        await fetch("/api/music", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: t.id }),
        });
        sharedRef.current.add(t.id);
      }
      el.src = mediaSrc(`https://drive.google.com/uc?export=download&id=${t.id}`);
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
              <>Automată, după tonul filmului — din folderul Drive „Muzica”.</>
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
            <div className={styles.hint}>Nu am găsit melodii în folderul „Muzica” de pe Drive.</div>
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
        </div>
      )}
      {note && <div className={styles.note}>{note}</div>}
    </div>
  );
}
