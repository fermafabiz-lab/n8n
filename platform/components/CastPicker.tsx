"use client";

import { useState } from "react";
import VoicePicker from "@/components/VoicePicker";

/**
 * The cast for a multi-voice story: the narrator (chosen with the normal
 * picker) plus the voices characters are allowed to speak with.
 *
 * The characters themselves don't exist yet at this point — they come out of
 * the story bible — so this picks a POOL. Once the script exists, each
 * character found in it is assigned one of these voices, and that assignment
 * is changeable in the audio panel.
 */
export default function CastPicker() {
  const [cast, setCast] = useState<string[]>([]);
  const toggle = (id: string) =>
    setCast((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );

  return (
    <div className="field">
      <input type="hidden" name="cast_voices" value={cast.join(",")} />
      <VoicePicker
        multi
        selectedIds={cast}
        onToggle={toggle}
        label={`Character voices — pick as many as you want (${cast.length} selected)`}
      />
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>
        These are the voices characters can speak with, alongside the narrator
        you chose above. The story&apos;s characters aren&apos;t written yet, so
        each one gets assigned a voice from this pool once the script exists —
        you can reassign any of them in the audio panel before anything is
        rendered.
      </p>
      {cast.length === 1 && (
        <p className="formmsg" style={{ marginTop: 8 }}>
          With a single character voice every character will sound the same.
          Pick one per character you expect, or leave this empty to keep a
          narrator-only video.
        </p>
      )}
    </div>
  );
}
