"use client";

import { useState, useTransition } from "react";
import { saveSeriesCharacter, type ActionResult } from "@/app/actions";
import type { SeriesCharacter as Character } from "@/lib/series";
import { initials } from "@/lib/series";
import s from "./SeriesCast.module.css";

/**
 * One member of the cast: the sheet the pipeline drew for them, their name,
 * their part, and the description every episode's Story Bible is told to
 * keep. The description is editable in place — it is CANON, and canon is
 * the producer's to write; the portrait is not, because a portrait that no
 * longer matches its description is exactly the drift a series exists to
 * prevent (a new sheet is a regeneration, not an edit).
 */
export default function SeriesCharacter({
  seriesId,
  character,
  portraitUrl,
  sheetKind,
}: {
  seriesId: string;
  character: Character;
  /** Our stored copy of the sheet, or null when none was ever kept. */
  portraitUrl: string | null;
  /** "turnaround" | "portrait" | null — decides how the picture is fitted. */
  sheetKind: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(character.role);
  const [desc, setDesc] = useState(character.description);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const r = await saveSeriesCharacter(seriesId, character.name, { role, description: desc });
      setMsg(r);
      if (r.ok) setEditing(false);
    });

  return (
    <article className={s.card}>
      <div className={`${s.portrait} ${sheetKind === "turnaround" ? s.wide : ""}`}>
        {portraitUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={portraitUrl} alt={`${character.name} — reference sheet`} loading="lazy" />
        ) : (
          <span className={s.initials} aria-label="no portrait kept yet">
            {initials(character.name)}
          </span>
        )}
        {sheetKind && <span className={s.kind}>{sheetKind}</span>}
      </div>
      <div className={s.body}>
        <h3 className={s.name}>{character.name}</h3>
        {!editing ? (
          <>
            {character.role && <span className={s.role}>{character.role}</span>}
            <p className={s.desc}>{character.description || "No description yet."}</p>
            <div className={s.row}>
              <button type="button" className={s.linkish} onClick={() => setEditing(true)}>
                Edit
              </button>
              {msg && !msg.ok && <span className={s.hint}>{msg.message}</span>}
            </div>
          </>
        ) : (
          <div className={s.edit}>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Part (protagonist, best friend…)" maxLength={200} />
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={6} maxLength={2000} placeholder="Exactly how they look — one age, one outfit." />
            <div className={s.row}>
              <button type="button" className="btn" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" className={s.linkish} onClick={() => { setEditing(false); setRole(character.role); setDesc(character.description); }}>
                Cancel
              </button>
            </div>
            {msg && !msg.ok && <span className={s.hint}>{msg.message}</span>}
          </div>
        )}
      </div>
    </article>
  );
}
