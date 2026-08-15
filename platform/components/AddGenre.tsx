"use client";

import { useState, useTransition } from "react";
import { addGenre, type AdminResult } from "@/app/admin/actions";

/**
 * Add a genre profile.
 *
 * Only the tone is asked for. A profile arrives inactive and empty, and the
 * rest is filled in by opening it below — because a half-written profile that
 * scripting starts using immediately is worse than none at all: the built-in
 * fallback is complete, and this one would not be.
 */
export default function AddGenre() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<AdminResult | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="btn addgenre" onClick={() => setOpen(true)}>
        + New genre
      </button>
    );
  }

  return (
    <form
      className="addgenreform"
      action={(form) =>
        start(async () => {
          const r = await addGenre(form);
          setResult(r);
          if (r.ok) setOpen(false);
        })
      }
    >
      <input name="tone" placeholder="Tone, exactly as the form offers it" autoFocus />
      <button className="btn gold" disabled={pending}>
        {pending ? "Creating…" : "Create"}
      </button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {result && !result.ok ? <span className="adminmsg err">{result.message}</span> : null}
    </form>
  );
}
