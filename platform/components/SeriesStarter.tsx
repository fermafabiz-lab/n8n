"use client";

import { useState } from "react";
import { createSeriesFromProject } from "@/app/actions";
import s from "./SeriesCast.module.css";

/**
 * A series starts from a film that already exists — its Story Bible is the
 * cast and the places, its reference sheets are the faces, its brief is the
 * settings. Nothing is invented here: the producer names the show and picks
 * the film, and the film becomes episode 1.
 */
export default function SeriesStarter({
  candidates,
  preselect = "",
}: {
  candidates: Array<{ id: string; name: string; status: string }>;
  /** A project id to land on selected — the project page links here with it. */
  preselect?: string;
}) {
  const [projectId, setProjectId] = useState(
    candidates.some((c) => c.id === preselect) ? preselect : (candidates[0]?.id ?? ""),
  );
  const [name, setName] = useState("");
  const [premise, setPremise] = useState("");
  return (
    <form action={createSeriesFromProject} className={s.starter}>
      <div>
        <label className={s.role} htmlFor="series-from">Start from this film</label>
        <select id="series-from" name="project_id" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
          {candidates.length === 0 && <option value="">No film has a Story Bible yet</option>}
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name.length > 70 ? c.name.slice(0, 70) + "…" : c.name}
              {c.status ? ` — ${c.status}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={s.role} htmlFor="series-name">The show&apos;s name</label>
        <input id="series-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pip and the Blue Scarf" required maxLength={140} />
      </div>
      <div>
        <label className={s.role} htmlFor="series-premise">What it is (optional)</label>
        <input id="series-premise" name="premise" value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="A small fox and her friends solve gentle mysteries in the meadow." maxLength={1200} />
      </div>
      <p className={s.hint}>
        The film&apos;s characters, places and look become the show&apos;s canon, its reference sheets
        become the faces every episode reuses, and the film becomes episode 1. You can edit every
        description afterwards.
      </p>
      <div>
        <button type="submit" className="btn" disabled={!projectId || !name.trim()}>
          Start the series
        </button>
      </div>
    </form>
  );
}
