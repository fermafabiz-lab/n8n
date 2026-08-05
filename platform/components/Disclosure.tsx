"use client";

import { useEffect, useState } from "react";

/**
 * A hairline summary row that expands into its children. Exists for the
 * error list: a third of the dashboard used to be a red panel standing
 * between the producer and their projects, for failures that are usually
 * already dealt with. Collapsed, the same information is one line.
 *
 * The open state is backed by sessionStorage when a storageKey is given —
 * the pages auto-refresh every 10-15s, which remounts this component, and a
 * list that snaps shut mid-read is worse than no disclosure at all.
 */
export default function Disclosure({
  summary,
  children,
  defaultOpen = false,
  storageKey,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Read after mount, not in the initializer: the server render has no
  // sessionStorage, and diverging from it during hydration is a mismatch.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = sessionStorage.getItem(`vf-disc:${storageKey}`);
      if (saved !== null) setOpen(saved === "1");
    } catch {}
  }, [storageKey]);

  const toggle = () => {
    setOpen((v) => {
      if (storageKey) {
        try {
          sessionStorage.setItem(`vf-disc:${storageKey}`, v ? "0" : "1");
        } catch {}
      }
      return !v;
    });
  };

  return (
    <div>
      <button type="button" className="dsum" onClick={toggle}>
        {summary}
        <span className="darr">{open ? "HIDE ↑" : "SHOW ↓"}</span>
      </button>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  );
}
