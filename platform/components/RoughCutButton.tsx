"use client";

import { useState } from "react";
import type { Scene } from "@/lib/data";
import RoughCut from "./RoughCut";
import styles from "./RoughCut.module.css";

/**
 * Opens the rough cut. A client shell so the project page can stay a server
 * component — the only state here is whether the panel is up.
 *
 * It appears as soon as ONE scene has something to show, because the value is
 * highest early: watching six stills under their takes is how you find out the
 * order is wrong, and that is worth knowing before sixty clips are generated
 * against it.
 */
export default function RoughCutButton({
  scenes,
  portrait = false,
}: {
  scenes: Scene[];
  portrait?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ready = scenes.filter((s) => s.videoUrl || s.imageUrl).length;
  if (!ready) return null;

  return (
    <>
      <button type="button" className={styles.open} onClick={() => setOpen(true)}>
        ▶ Rough cut
        <span className={styles.count}>{ready}</span>
      </button>
      {open && (
        <RoughCut scenes={scenes} portrait={portrait} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
