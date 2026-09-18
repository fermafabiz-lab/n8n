"use client";

import { useState, useTransition } from "react";
import { saveSeriesNotes, writeRecapFromEpisodes, type ActionResult } from "@/app/actions";
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
  episodes = 0,
}: {
  seriesId: string;
  name: string;
  premise: string;
  previously: string;
  channelName: string;
  /** How many episodes the show has — the recap is written from them. */
  episodes?: number;
}) {
  const [v, setV] = useState({ name, premise, previously, channelName });
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = v.name !== name || v.premise !== premise || v.previously !== previously || v.channelName !== channelName;
  const save = () =>
    start(async () => {
      setMsg(await saveSeriesNotes(seriesId, v));
    });
  /*
   * The recap is written from the episodes rather than typed. The pipeline
   * has done this on its own since 2026-09-16, but only FORWARD — at the
   * moment a script is approved. Episode 1 of every show is the film the
   * show was started from, and its script was approved before the show
   * existed, so every show's first line is missing and this is the only way
   * to get it without typing.
   *
   * It writes straight into the field because the action returns the new
   * text: revalidating the page alone would not reach this component's
   * state, and the producer would press a button and watch nothing change.
   */
  const [writing, setWriting] = useState(false);
  const recapDirty = v.previously !== previously;
  const write = () => {
    setWriting(true);
    start(async () => {
      const r = await writeRecapFromEpisodes(seriesId);
      setMsg(r);
      if (r.previously !== undefined) setV((x) => ({ ...x, previously: r.previously ?? x.previously }));
      setWriting(false);
    });
  };
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
          <textarea rows={5} value={v.previously} onChange={(e) => setV({ ...v, previously: e.target.value })} maxLength={8000} placeholder="A running recap, one line per episode. The pipeline adds the line itself when an episode's script is approved; edit or trim it here whenever you like. The next episode is told not to contradict it and not to retell it." />
          {episodes > 0 && (
            <div className={s.row} style={{ marginTop: 8 }}>
              <button
                type="button"
                className="abtn"
                onClick={write}
                disabled={pending || recapDirty}
                title={
                  recapDirty
                    ? "Save or undo your edit first — this rewrites the recap from the episodes"
                    : "Summarise every episode's approved script into one line each. A line you typed yourself that is not in “Episode N — …” shape is left alone."
                }
              >
                {writing
                  ? "Reading the episodes…"
                  : v.previously.trim()
                    ? "✎ Write it again from the episodes"
                    : `✎ Write it from the ${episodes === 1 ? "episode" : `${episodes} episodes`}`}
              </button>
            </div>
          )}
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
