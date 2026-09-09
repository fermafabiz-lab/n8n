/**
 * The relevance ranker. One score per candidate, 0–100, on the spec's weights:
 *
 *   semantic relevance 0–25 · exact event 0–20 · date 0–15 · location 0–15 ·
 *   people/organisations 0–10 · visual usefulness 0–5 · media quality 0–5 ·
 *   provider metadata reliability 0–5
 *
 * and the spec's penalties, applied only on a MISMATCH the asset itself
 * states — never on an absence:
 *
 *   wrong event −35 · wrong location −30 · wrong date −25 ·
 *   poor visual match −15 · recently reused −10
 *
 * Rights are not a penalty. A restricted asset is not "a bit less relevant";
 * it is out, and the engine removes it before anything is scored.
 *
 * B-roll first (§22): when a scene does not need a speaking person, a
 * twenty-minute press conference is not a slightly worse answer than eight
 * seconds of border footage — it is the wrong kind of thing, and the visual
 * score says so.
 */

import { matchSignals, type MatchSignals } from "./match";
import type { FootageFormat, FootageSearchRequest, NormalizedFootageAsset, PreferredFootageType } from "./types";

export const RANK_WEIGHTS = {
  semantic: 25,
  event: 20,
  date: 15,
  location: 15,
  peopleOrgs: 10,
  visual: 5,
  quality: 5,
  reliability: 5,
} as const;

export const RANK_PENALTIES = {
  wrongEvent: -35,
  wrongLocation: -30,
  wrongDate: -25,
  poorVisual: -15,
  reused: -10,
} as const;

/** How much the engine trusts a provider's METADATA — not its footage. */
export const PROVIDER_RELIABILITY: Record<string, number> = {
  dvids: 1,
  nasa: 1,
  eu_av: 0.9,
  wikimedia: 0.6,
  url_import: 0.3,
  user_upload: 0.4,
};

const SPEAKING: ReadonlySet<FootageFormat> = new Set(["speech", "press_conference", "interview"]);
const PICTURES: ReadonlySet<FootageFormat> = new Set(["broll", "stockshots", "news_package", "documentary"]);

/**
 * 0..1: how USEFUL this shot is for the kind of scene that asked, before any
 * question of relevance. A long talking head under narration that wants
 * pictures scores near zero even when every word of its title matches.
 */
export function visualUsefulness(
  a: NormalizedFootageAsset,
  want: PreferredFootageType | undefined,
  preferredMediaType: "video" | "image",
): number {
  const fmt = a.footageFormat ?? "unknown";
  const dur = a.durationSeconds ?? null;
  let v = 0.6;
  const wantsSpeech = want === "speech" || want === "interview";

  if (a.mediaType === "video") {
    if (wantsSpeech) {
      v = SPEAKING.has(fmt) ? 1 : PICTURES.has(fmt) ? 0.35 : 0.6;
    } else {
      // Narration wants pictures.
      if (PICTURES.has(fmt)) v = 1;
      else if (SPEAKING.has(fmt)) v = 0.15;
      else v = 0.65;
      // A scene is eight seconds. A reel over ten minutes is a haystack; the
      // producer would have to find the shot in it.
      if (dur !== null) {
        if (dur < 3) v *= 0.4;
        else if (dur > 600) v *= 0.5;
        else if (dur > 180) v *= 0.85;
      }
    }
    if (preferredMediaType === "image") v *= 0.8;
  } else {
    // A still under narration is an animatic, not a clip — fine when asked
    // for, a fallback when video was wanted (§32: real image before AI).
    v = preferredMediaType === "image" ? 0.9 : wantsSpeech ? 0.2 : 0.5;
  }
  return Math.max(0, Math.min(1, v));
}

export interface RankResult {
  score: number;
  reasons: string[];
  signals: MatchSignals;
}

export function rankOne(
  r: FootageSearchRequest,
  a: NormalizedFootageAsset,
  opts: { reused?: boolean; signals?: MatchSignals } = {},
): RankResult {
  const s = opts.signals ?? matchSignals(r, a);
  const W = RANK_WEIGHTS;
  const P = RANK_PENALTIES;
  const reasons: string[] = [];
  let score = 0;

  const semantic = Math.round(W.semantic * s.topic);
  score += semantic;
  if (semantic >= 10) reasons.push(`shares the scene's vocabulary (${semantic}/${W.semantic})`);

  if (s.event === "yes") {
    score += W.event;
    reasons.push("names the event");
  } else if (s.event === "no") {
    score += P.wrongEvent;
    reasons.push("names a different event");
  }

  if (s.date === "yes") {
    score += W.date;
    reasons.push("dated inside the scene's window");
  } else if (s.date === "no") {
    score += P.wrongDate;
    reasons.push("dated outside the scene's window");
  }

  if (s.location === "yes") {
    score += W.location;
    reasons.push("names the place");
  } else if (s.location === "no") {
    score += P.wrongLocation;
    reasons.push("names a different country");
  }

  if (s.peopleOrgs === "yes") {
    score += W.peopleOrgs;
    reasons.push("names the people or organisations");
  }

  const vis = visualUsefulness(a, r.preferredFootageType, r.preferredMediaType);
  score += Math.round(W.visual * vis);
  if (vis <= 0.2) {
    score += P.poorVisual;
    reasons.push(
      a.mediaType === "video" && SPEAKING.has(a.footageFormat ?? "unknown")
        ? "a talking head where the scene wants pictures"
        : "the wrong kind of shot for this scene",
    );
  }

  score += Math.round(W.quality * Math.max(0, Math.min(1, a.qualityScore ?? 0)));
  score += Math.round(W.reliability * (PROVIDER_RELIABILITY[a.provider] ?? 0.3));

  if (opts.reused) {
    score += P.reused;
    reasons.push("already used in a film recently");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons, signals: s };
}

/**
 * Sort candidates best first, with the B-roll ladder as the tie-breaker.
 * Under narration: pictures, then video of no stated kind, then a still,
 * then a talking head — a real photograph of the event beats a press
 * conference about it, because the still can carry the scene and the
 * speaker cannot (§22). A scene that quotes someone inverts the top of the
 * ladder; a scene that asked for a picture puts stills first.
 */
export function orderByScore<T extends { score: number; asset: NormalizedFootageAsset }>(
  items: T[],
  r: FootageSearchRequest,
): T[] {
  const wantsSpeech = r.preferredFootageType === "speech" || r.preferredFootageType === "interview";
  const tier = (a: NormalizedFootageAsset): number => {
    const fmt = a.footageFormat ?? "unknown";
    if (r.preferredMediaType === "image") {
      if (a.mediaType === "image") return 0;
      return PICTURES.has(fmt) ? 1 : SPEAKING.has(fmt) ? 3 : 2;
    }
    if (wantsSpeech) {
      if (a.mediaType !== "video") return 2;
      return SPEAKING.has(fmt) ? 0 : 1;
    }
    if (a.mediaType !== "video") return 2;
    return PICTURES.has(fmt) ? 0 : SPEAKING.has(fmt) ? 3 : 1;
  };
  return [...items].sort((x, y) => y.score - x.score || tier(x.asset) - tier(y.asset));
}
