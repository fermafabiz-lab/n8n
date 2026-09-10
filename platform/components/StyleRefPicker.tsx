"use client";

/**
 * Which library scripts the writer imitates — chosen by the producer, on the
 * brief, instead of guessed by tone.
 *
 * Claude Scripting has always shown the writer a style card and a verbatim
 * excerpt from "scripts of this genre", matched on the film's tone. On the
 * Burj Al Arab film that match picked a Moroccan McDonald's vlog and a
 * YouTube Shorts tutorial while the producer's own Burj Al Arab transcript sat
 * in the library under a different tone label. The pin is the fix: up to three
 * rows, in order, stored as `Editing Options.styleRefs`, and `/api/style-refs`
 * puts them first. Nothing pinned keeps the tone match (family-matched now, so
 * "Educativ" finds "Educational").
 *
 * Rows that fit the chosen tone are listed first, with a badge; the rest are
 * still there because a producer may want a horror film written like a
 * documentary. The value travels as a hidden input (`style_refs`, a JSON list
 * of ids) like every other control on this form.
 */

import { useEffect, useMemo, useState } from "react";
import { MAX_STYLE_REFS, toneFamily } from "@/lib/style-refs";
import styles from "./StyleRefPicker.module.css";

type Row = {
  id: string;
  title: string;
  tone: string | null;
  category: string | null;
  pacingWpm: number | null;
  durationSeconds: number | null;
  thin: boolean;
};

function mins(s: number | null): string {
  if (!s || s <= 0) return "";
  return `${Math.round(s / 60)} min`;
}

export default function StyleRefPicker({ tone }: { tone: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/style-library", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { rows?: Row[]; error?: string }) => {
        if (!alive) return;
        setRows(Array.isArray(j.rows) ? j.rows : []);
        if (j.error) setError(j.error);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setError("library unreachable");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const want = toneFamily(tone);
  const fits = (r: Row) => !!want && (toneFamily(r.tone) === want || toneFamily(r.category) === want);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (rows ?? []).filter(
      (r) => !needle || `${r.title} ${r.tone ?? ""} ${r.category ?? ""}`.toLowerCase().includes(needle),
    );
    // Fitting rows first, then the rest, each alphabetical.
    return list.sort((a, b) => Number(fits(b)) - Number(fits(a)) || a.title.localeCompare(b.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, want]);

  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);
  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_STYLE_REFS ? c : [...c, id]));

  const fitCount = (rows ?? []).filter(fits).length;

  return (
    <div className={styles.box}>
      <input type="hidden" name="style_refs" value={JSON.stringify(chosen)} />
      {chosen.length > 0 && (
        <div className={styles.chosen}>
          {chosen.map((id, i) => (
            <button
              type="button"
              key={id}
              className={styles.chip}
              title="Remove"
              onClick={() => toggle(id)}
            >
              {i + 1}. {byId.get(id)?.title ?? id} ✕
            </button>
          ))}
        </div>
      )}
      <input
        className={styles.search}
        type="search"
        placeholder={rows === null ? "Loading the library…" : `Search ${rows.length} scripts…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={rows === null}
      />
      <div className={styles.list} role="listbox" aria-label="Reference scripts">
        {rows !== null && shown.length === 0 && (
          <div className={styles.meta} style={{ padding: "6px 10px" }}>
            {error ? `Library unavailable (${error}).` : "No script matches."}
          </div>
        )}
        {shown.map((r) => {
          const on = chosen.includes(r.id);
          const full = !on && chosen.length >= MAX_STYLE_REFS;
          return (
            <button
              type="button"
              key={r.id}
              className={`${styles.row} ${on ? styles.on : ""}`}
              onClick={() => toggle(r.id)}
              disabled={full}
              role="option"
              aria-selected={on}
              title={r.thin ? "Short transcript — the writer gets its style card but no excerpt" : undefined}
            >
              <span className={styles.mark}>{on ? "✓" : ""}</span>
              <span className={styles.title}>{r.title}</span>
              {fits(r) && <span className={styles.fit}>fits {tone}</span>}
              <span className={styles.meta}>
                {[r.tone, r.category].filter(Boolean).join(" · ")}
                {mins(r.durationSeconds) ? ` · ${mins(r.durationSeconds)}` : ""}
                {r.thin ? " · thin" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.foot}>
        <span>
          {chosen.length === 0
            ? want
              ? `Nothing pinned — the writer gets the ${fitCount} script${fitCount === 1 ? "" : "s"} that fit ${tone}, three at most.`
              : "Nothing pinned — the writer gets the scripts matching the tone."
            : `${chosen.length} of ${MAX_STYLE_REFS} pinned — shown to the writer in this order, before any tone match.`}
        </span>
        <span>Rhythm and voice are imitated, never the words or the subject.</span>
      </div>
    </div>
  );
}
