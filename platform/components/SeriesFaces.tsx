"use client";

import { useState, useTransition } from "react";
import { bringBackFaces, type ActionResult } from "@/app/actions";
import s from "./SeriesCast.module.css";

/**
 * "Some of these have no picture" — and the one button that fixes it.
 *
 * A sheet is referenced by its Flow id, and the bytes are kept separately
 * (db/012, `sheet_media`). Anything drawn before that keeping went live on
 * 2026-09-17 has an id and no picture, so the cards fall back to initials.
 * The repo believed those pictures were gone; they are not, and this asks
 * Flow for them — see `db/port/sheet-backfill/README.md`.
 *
 * Two counts, deliberately separate, because they are two different
 * situations and only one of them is fixable:
 *
 * - `missing` — referenced, no picture kept. This is what the button fetches.
 * - `undrawn` — in the Story Bible with no sheet at ALL. The pipeline draws a
 *   sheet for a character always, for an object only when it appears in two
 *   or more scenes and at most three per film (`Cast Sheet Prep`). A prop
 *   seen once is SUPPOSED to have no sheet, so the panel says so rather than
 *   offering a button that could not help it. Drawing one now would cost a
 *   generation and produce a picture no film ever used.
 */
export default function SeriesFaces({
  seriesId,
  missing,
  undrawn,
}: {
  seriesId: string;
  missing: number;
  undrawn: number;
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (missing === 0 && undrawn === 0) return null;
  return (
    <div className={s.banner}>
      <div className={s.bannertext}>
        <b>
          {missing > 0
            ? `${missing} reference sheet${missing === 1 ? "" : "s"} ${missing === 1 ? "has" : "have"} no picture here`
            : "Some entries were never given a sheet"}
        </b>
        <p>
          {missing > 0 ? (
            <>
              They were drawn before the site started keeping a copy, and their link to Flow has
              expired — but the pictures themselves are still there. This fetches them back; the
              films are unaffected either way, since the pipeline attaches sheets by id.
              {undrawn > 0 &&
                ` ${undrawn} other${undrawn === 1 ? "" : "s"} never had a sheet at all: an object gets one only when it appears in two or more scenes.`}
            </>
          ) : (
            `${undrawn} ${undrawn === 1 ? "entry has" : "entries have"} no sheet at all — an object gets one only when it appears in two or more scenes, so a prop seen once shows its initials on purpose.`
          )}
        </p>
        {msg && (
          <p className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 8 }}>
            {msg.message}
          </p>
        )}
      </div>
      {missing > 0 && (
        <button
          type="button"
          className="abtn"
          disabled={pending}
          onClick={() => start(async () => setMsg(await bringBackFaces(seriesId)))}
        >
          {pending ? "Asking Flow…" : "⤓ Bring the pictures back"}
        </button>
      )}
    </div>
  );
}
