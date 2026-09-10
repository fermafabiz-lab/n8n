"use client";

/**
 * "Footage type" — the producer's own answer to what a scene's picture IS.
 *
 * The classifier can tell an AI picture from a catalogued archive item. It
 * cannot tell whether an archive clip shows THE event the narration is
 * describing, at that place, on that day: that is a judgement about the world,
 * and it is the one this whole feature exists to get right. So ACTUAL FOOTAGE
 * and ILLUSTRATIVE FOOTAGE are reachable only here, by a person — and choosing
 * one records that a person chose it.
 *
 * Two moves are refused outright rather than confirmed (see `refuseFootageType`
 * on the server, which is where the decision actually lives): an AI picture can
 * never be relabelled as real of any kind, and a real archive picture can never
 * be relabelled as AI. A confirmation dialog cannot make either of them true.
 *
 * What it shows above the control is deliberately everything the decision needs
 * — provider, title, the catalogue's own date (labelled, because it lies) and
 * the confidence — so nobody has to open the archive page to answer it.
 */

import { useState, useTransition } from "react";
import { setSceneFootageType, type ActionResult } from "@/app/actions";
import {
  ORIGIN_DESCRIPTIONS,
  ORIGIN_LABELS,
  VISUAL_ORIGINS,
  cleanCreator,
  isRealOrigin,
  providerLabel,
  type VisualOrigin,
} from "@/lib/provenance";
import type { Scene } from "@/lib/data";
import styles from "./FootageTypePicker.module.css";

export default function FootageTypePicker({
  projectId,
  scene,
  pending,
}: {
  projectId: string;
  scene: Scene;
  /** A write is already in flight somewhere on the board. */
  pending: boolean;
}) {
  const p = scene.provenance;
  const [origin, setOrigin] = useState<VisualOrigin>(p.visualOrigin);
  const [eventName, setEventName] = useState(p.eventName ?? "");
  const [location, setLocation] = useState(p.originalLocation ?? "");
  const [date, setDate] = useState(p.originalDate ?? "");
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [busy, startTransition] = useTransition();

  const generated = scene.visualSource === "ai";
  // Offered, not hidden: a producer has to be able to SEE that "Actual
  // footage" exists and why this scene cannot be it. The server refuses and
  // says what to do instead — replace the media — which is a better answer
  // than a control that silently has fewer options on some scenes.
  const dirty =
    origin !== p.visualOrigin ||
    eventName.trim() !== (p.eventName ?? "") ||
    location.trim() !== (p.originalLocation ?? "") ||
    date.trim() !== (p.originalDate ?? "");
  const showDetails = isRealOrigin(origin);

  const save = () =>
    startTransition(async () => {
      const r = await setSceneFootageType(projectId, scene.id, origin, {
        eventName,
        location,
        date,
      });
      setMsg(r);
      if (!r.ok) setOrigin(p.visualOrigin);
    });

  const reset = () =>
    startTransition(async () => {
      const r = await setSceneFootageType(projectId, scene.id, "auto");
      setMsg(r);
    });

  // The same cleaning the watermark does: Commons answers the author field
  // with the wiki template that renders it, so a photographer arrives as
  // "Template:Helmut Laux".
  const who = cleanCreator(p.sourceCreator) || providerLabel(p.provider);
  // The title is dropped when it merely repeats the creator — Commons files
  // are routinely named after their author ("Julien Bryan · Julien Bryan -
  // Siege"), and a doubled name reads as a bug rather than as two fields.
  const title = who && p.sourceTitle?.includes(who) ? null : p.sourceTitle;
  const facts = [
    who,
    title,
    p.provenanceConfidence !== undefined ? `confidence ${p.provenanceConfidence}%` : null,
    p.manuallyVerified ? "set by hand" : null,
  ].filter(Boolean) as string[];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <label htmlFor={`ft_${scene.id}`}>Footage type</label>
        <span className={`${styles.badge} ${generated ? styles.ai : styles.real}`}>
          {ORIGIN_LABELS[p.visualOrigin]}
        </span>
      </div>

      {facts.length > 0 && <p className={styles.facts}>{facts.join(" · ")}</p>}
      {p.sourceUrl && (
        <p className={styles.facts}>
          <a href={p.sourceUrl} target="_blank" rel="noreferrer">
            source ↗
          </a>
        </p>
      )}

      <select
        id={`ft_${scene.id}`}
        className={styles.select}
        value={origin}
        disabled={pending || busy}
        onChange={(e) => {
          setOrigin(e.target.value as VisualOrigin);
          setMsg(null);
        }}
      >
        {VISUAL_ORIGINS.map((o) => (
          <option key={o} value={o}>
            {ORIGIN_LABELS[o]}
          </option>
        ))}
      </select>
      <p className={styles.hint}>{ORIGIN_DESCRIPTIONS[origin]}</p>

      {/* Only for a real origin, and only ever what a person types. The
          archive's own date is not offered as a default here on purpose: it is
          the upload date often enough that pre-filling it would put a guess on
          screen under the producer's name. */}
      {showDetails && (
        <div className={styles.fields}>
          <input
            className={styles.input}
            placeholder="What event? (optional)"
            value={eventName}
            disabled={pending || busy}
            onChange={(e) => setEventName(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Where? (optional)"
            value={location}
            disabled={pending || busy}
            onChange={(e) => setLocation(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="When? (optional)"
            value={date}
            disabled={pending || busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      )}

      <div className={styles.row}>
        <button
          type="button"
          className="abtn ok"
          disabled={pending || busy || !dirty}
          onClick={save}
        >
          Save footage type
        </button>
        {p.manuallyVerified && (
          <button
            type="button"
            className="abtn"
            disabled={pending || busy}
            title="Let the pipeline decide this scene's type again from its media and its prompt"
            onClick={reset}
          >
            Automatic
          </button>
        )}
      </div>

      {msg && <p className={`${styles.msg} ${msg.ok ? styles.ok : styles.err}`}>{msg.message}</p>}
    </div>
  );
}
