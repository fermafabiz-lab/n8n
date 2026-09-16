"use client";

import { useState, useTransition } from "react";
import { saveSeriesNotes, type ActionResult } from "@/app/actions";
import s from "./SeriesCast.module.css";

/**
 * The words of a series the producer owns outright: its name, what the show
 * is, what has happened so far, and the channel it goes out on. All four ride
 * into the next episode's brief — the premise and the recap as canon for the
 * Story Bible (lib/series.ts composeSeriesLore), the name as the episode's
 * eyebrow. Saved as a whole; the fields are small enough that a form beats
 * four inline editors.
 */
export default function SeriesNotes({
  seriesId,
  name,
  premise,
  previously,
  channelName,
}: {
  seriesId: string;
  name: string;
  premise: string;
  previously: string;
  channelName: string;
}) {
  const [v, setV] = useState({ name, premise, previously, channelName });
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = v.name !== name || v.premise !== premise || v.previously !== previously || v.channelName !== channelName;
  const save = () =>
    start(async () => {
      setMsg(await saveSeriesNotes(seriesId, v));
    });
  return (
    <div>
      <div className={s.notes}>
        <div>
          <label>Show</label>
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={140} />
        </div>
        <div>
          <label>Channel (for the end screen, later)</label>
          <input value={v.channelName} onChange={(e) => setV({ ...v, channelName: e.target.value })} maxLength={140} placeholder="The channel this show goes out on" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label>What the show is</label>
          <textarea rows={3} value={v.premise} onChange={(e) => setV({ ...v, premise: e.target.value })} maxLength={1200} placeholder="One or two sentences: who it is about, where, and what kind of adventures." />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label>What has happened so far</label>
          <textarea rows={5} value={v.previously} onChange={(e) => setV({ ...v, previously: e.target.value })} maxLength={4000} placeholder="A running recap. The next episode is told not to contradict it and not to retell it — add a line after each episode." />
        </div>
      </div>
      <div className={s.row} style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={save} disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && <span className={s.hint}>{msg.ok ? "Saved." : msg.message}</span>}
      </div>
    </div>
  );
}
