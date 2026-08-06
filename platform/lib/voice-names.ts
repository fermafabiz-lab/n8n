"use client";

import { useEffect, useState } from "react";

/**
 * Voice id -> display name, the way the picker shows it.
 *
 * Everything past the form stores only the prefixed id
 * ("elevenlabs_CwhRBWXzGAHq8TQ4Fs17"), so review screens used to print a
 * truncated code at the producer, who picked "Charlie" and has no idea which
 * code that was. The names come back from /api/voices, which reads the same
 * ai33 library the picker does.
 *
 * The cache is module-level and shared by every component on the page: a
 * project's cast is the same handful of ids repeated across the chapter list,
 * the per-scene chips and the pinning dropdown, and one request should serve
 * all of them.
 */
const cache = new Map<string, string>();
/** Ids already asked about, so a miss isn't re-requested on every render. */
const asked = new Set<string>();
const listeners = new Set<() => void>();

async function fetchNames(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => id && !asked.has(id));
  if (missing.length === 0) return;
  for (const id of missing) asked.add(id);
  try {
    const res = await fetch(`/api/voices?ids=${encodeURIComponent(missing.join(","))}`);
    if (!res.ok) return;
    const data = (await res.json()) as { names?: Record<string, string> };
    let changed = false;
    for (const [id, name] of Object.entries(data.names ?? {})) {
      if (name) {
        cache.set(id, name);
        changed = true;
      }
    }
    if (changed) for (const l of listeners) l();
  } catch {
    // Offline or ai33 down — callers keep showing the short code.
  }
}

/**
 * Resolve a set of voice ids to names. Returns a labeller that falls back to
 * a readable short form, so a name that never resolves degrades instead of
 * rendering blank.
 */
export function useVoiceNames(ids: Array<string | null | undefined>) {
  const [, bump] = useState(0);
  const key = ids.filter(Boolean).join(",");

  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    listeners.add(rerender);
    void fetchNames(key ? key.split(",") : []);
    return () => {
      listeners.delete(rerender);
    };
  }, [key]);

  return (id: string | null | undefined): string => {
    if (!id) return "";
    return cache.get(id) ?? shortVoiceId(id);
  };
}

/** "elevenlabs_CwhRBWXzGAHq8TQ4Fs17" -> "elevenlabs · …Q4Fs17". */
export function shortVoiceId(id: string): string {
  if (!id) return "—";
  const [provider, ...rest] = id.split("_");
  const tail = rest.join("_");
  return `${provider} · …${tail.slice(-6)}`;
}
