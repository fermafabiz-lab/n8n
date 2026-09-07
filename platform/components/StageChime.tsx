"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The ding, now with words.
 *
 * Plays a short two-tone ding when any watched item moves INTO a stage that
 * needs the user (review gates, finished, error), or when a `have:` item
 * gains entries (a new scene/take/image/clip landed). The page re-renders
 * itself via AutoRefresh, so this only diffs incoming stages against the
 * last ones seen in this browser session (sessionStorage survives refreshes
 * and remounts).
 *
 * The sound used to be the whole message, and the producer's complaint was
 * exact: you hear that something finished and then hunt through the page to
 * find out what. The same events now also SAY what happened, in two ways
 * that never overlap:
 *
 * - the tab is visible  → an in-page toast (bottom-right, gone in ~8s);
 * - the tab is hidden   → a system notification, because that is precisely
 *   the situation where the ding reaches you from another tab or app with
 *   no way to tell what it was. Clicking it focuses the tab. Requires the
 *   one-time browser permission — see NotifyChip.
 *
 * Both carry the same words, built from the diff itself: which scenes'
 * assets are new since the last look ("S7 finished") and which one the
 * batch is plausibly on next ("S8 in work") — the latter labelled by the
 * same honesty rule ProductionActivity carries: the batch reports no
 * per-scene progress, so "next" is the first scene still missing the asset,
 * an estimate and never a fact.
 *
 * Browsers only allow audio after the user has interacted with the page once
 * (any click/keypress since the tab was opened counts), which matches the
 * "site open in a tab" use case. A ● is also prepended to the tab title so a
 * missed ding is still visible.
 */

// Stages worth interrupting someone for.
const ALERT_STAGES = new Set([
  "script-review",
  "scene-review",
  "voice-review",
  "image-review",
  "video-review",
  "needs-review",
  "finished",
  "error",
]);

// The review gates hands-off mode signs off by itself within seconds —
// under it, announcing them would produce "ready for review" instantly
// followed by "approved", which is noise about a decision nobody is making.
// `finished` and `error` stay: those are real under any mode.
const GATE_STAGES = new Set([
  "script-review",
  "scene-review",
  "voice-review",
  "image-review",
  "video-review",
  "needs-review",
]);

/** What a gate transition says. Keys are the page's stage vocabulary. */
const GATE_MESSAGES: Record<string, string> = {
  "script-review": "Script written — waiting for your approval",
  "scene-review": "Scene texts ready — waiting for review",
  "voice-review": "Takes ready to listen",
  "image-review": "Images ready for review",
  "video-review": "Clips ready for review",
  "needs-review": "Waiting on you",
  finished: "Film finished 🎬",
  error: "Something failed — open the project",
};

const STORE_KEY = "vf-stage-chime";

function readStore(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

let ctx: AudioContext | null = null;

function playNotes(notes: Array<[number, number]>, gainPeak = 0.18) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
      if (ctx.state === "suspended") return;
    }
    const t0 = ctx.currentTime;
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(gainPeak, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.75);
    }
  } catch {
    // Audio unavailable — never break the page over a chime.
  }
}

// Classic pleasant "ding" — something finished / needs review.
export function ding() {
  playNotes([
    [1318.5, 0],
    [1760, 0.12],
  ]);
}

// Urgent descending triple — production stalled / attention required.
export function alarm() {
  playNotes(
    [
      [880, 0],
      [660, 0.18],
      [440, 0.36],
    ],
    0.22,
  );
}

export function markTitle() {
  if (document.visibilityState === "visible") return;
  const original = document.title.replace(/^● /, "");
  document.title = `● ${original}`;
  const clear = () => {
    document.title = original;
    document.removeEventListener("visibilitychange", clear);
  };
  document.addEventListener("visibilitychange", clear);
}

/** One system notification, only when nobody is looking at the page —
 *  a toast covers the visible case, and firing both would double every
 *  event. `tag` makes a newer message replace its predecessor in the OS
 *  tray instead of piling up. */
function systemNotify(title: string, body: string, tag: string) {
  try {
    if (document.visibilityState === "visible") return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // A notification must never break the page either.
  }
}

/**
 * The one-time permission ask, as a chip that removes itself.
 *
 * Browsers only grant Notification.requestPermission from a user gesture, so
 * this cannot happen silently — and should not: a site asking for
 * notifications the moment it loads is what everyone has learned to refuse.
 * The chip renders only while the answer is still "default"; granted or
 * denied, it is gone. Client-only state, so it renders nothing on the server
 * pass and cannot mismatch hydration.
 */
export function NotifyChip() {
  const [state, setState] = useState<string | null>(null);
  useEffect(() => {
    setState("Notification" in window ? Notification.permission : null);
  }, []);
  if (state !== "default") return null;
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          setState(await Notification.requestPermission());
        } catch {
          setState("denied");
        }
      }}
    >
      🔔 Enable notifications
    </button>
  );
}

export type ChimeItem = {
  /** Stable id — the diff key. */
  key: string;
  /** A stage name, or `have:S1|S2|…` — the labels that HAVE this asset. */
  stage: string;
  /** Headline for the pop-up ("Images", or the project name on gate items).
   *  Without it the item dings and marks the title exactly as before, and
   *  says nothing — which keeps every existing caller valid. */
  label?: string;
  /** Denominator for `have:` items — "Images · 12/71". */
  total?: number;
  /** The batch's plausible next scene — an estimate, see the header note. */
  next?: string | null;
  /** What landing means for this asset: finished / written / recorded. */
  verb?: string;
};

type Toast = { id: number; title: string; body: string };

let toastSeq = 0;

/** "S5" / "S5, S6" / "7 scenes (S1–S7)" — the diff, sized for one line. */
function nameNew(labels: string[]): string {
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.length} scenes (${labels[0]}–${labels[labels.length - 1]})`;
}

export default function StageChime({
  items,
  quietGates = false,
}: {
  items: ChimeItem[];
  /** Hands-off mode: skip the review-gate announcements (finished and error
   *  still land) — the mode approves those gates itself within seconds. */
  quietGates?: boolean;
}) {
  const signature = JSON.stringify(items);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const store = readStore();
    let changed = false;
    let shouldDing = false;
    const messages: Array<{ title: string; body: string; tag: string }> = [];

    for (const it of items) {
      const prev = store[it.key];
      if (prev === it.stage) continue;
      store[it.key] = it.stage;
      changed = true;
      // Never on the very first sighting of a key — a page load of a fresh
      // session isn't news.
      if (prev === undefined) continue;

      if (it.stage.startsWith("have:")) {
        // Additions are the event. A shrinking list is regen bookkeeping
        // (an asset being replaced), which the regen's own UI already shows
        // — dinging on it announced nothing anyone could act on.
        const now = it.stage.slice(5).split("|").filter(Boolean);
        const before = new Set((prev.startsWith("have:") ? prev.slice(5) : "").split("|"));
        const fresh = now.filter((l) => !before.has(l));
        if (fresh.length === 0) continue;
        shouldDing = true;
        if (it.label) {
          const head =
            it.total !== undefined ? `${it.label} · ${now.length}/${it.total}` : it.label;
          const parts = [`${nameNew(fresh)} ${it.verb ?? "finished"}`];
          if (it.next) parts.push(`${it.next} in work`);
          messages.push({ title: head, body: parts.join(" · "), tag: it.key });
        }
      } else if (ALERT_STAGES.has(it.stage)) {
        if (quietGates && GATE_STAGES.has(it.stage)) continue;
        shouldDing = true;
        const text = GATE_MESSAGES[it.stage];
        if (text) {
          messages.push({ title: it.label ?? "House of Videos", body: text, tag: it.key });
        }
      } else if (it.stage.startsWith("count:") && prev.startsWith("count:")) {
        // The pre-`have:` form, still used by callers that only count.
        shouldDing = true;
      }
    }

    if (changed) sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
    if (shouldDing) {
      ding();
      markTitle();
    }
    if (messages.length > 0) {
      for (const m of messages) systemNotify(m.title, m.body, m.tag);
      if (document.visibilityState === "visible") {
        const fresh = messages.map((m) => ({ id: ++toastSeq, title: m.title, body: m.body }));
        setToasts((t) => [...t, ...fresh]);
        for (const f of fresh) {
          timers.current.push(
            setTimeout(() => setToasts((t) => t.filter((x) => x.id !== f.id)), 8000),
          );
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );

  if (toasts.length === 0) return null;
  return (
    <div className="toaststack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <b>{t.title}</b>
          <span>{t.body}</span>
        </div>
      ))}
    </div>
  );
}
