/**
 * The provenance engine — what a real asset IS, for the scene that asked.
 *
 * Two questions, answered separately because they have different evidence:
 *
 * 1. What is the asset on its own? Real moving footage from an archive, a
 *    real photograph, stock, an upload nobody has vouched for. That comes
 *    from the media type and the provider, and it is the answer the library
 *    stores on the row (`stock_media.provenance`).
 * 2. Is it footage OF the event this scene narrates? That is a match between
 *    the request and the asset's METADATA — event name, filming date, place,
 *    people — never its appearance. Scored out of 100 on the spec's weights:
 *
 *        exact event 30 · date 20 · location 20 · people/org 10 · topic 10 ·
 *        metadata quality 10
 *
 *    and only a score at or past `ACTUAL_FOOTAGE_MIN_CONFIDENCE` with the
 *    event, the date AND the place each confirmed may say ACTUAL FOOTAGE.
 *    Everything real that falls short of that, for a scene that named an
 *    event, is ILLUSTRATIVE — real, and not this.
 *
 * The media-only classifier in lib/provenance.ts (`classifyVisualOrigin`)
 * still never says actual_footage: it has no request to match against. This
 * is the one place that can, and it can only because the providers this
 * engine talks to record filming dates and locations on purpose.
 */

import { ACTUAL_FOOTAGE_MIN_CONFIDENCE } from "@/lib/provenance";
import { matchSignals, type MatchSignals } from "./match";
import type { FootageProvenance, FootageSearchRequest, NormalizedFootageAsset } from "./types";

export const PROVENANCE_WEIGHTS = {
  event: 30,
  date: 20,
  location: 20,
  peopleOrgs: 10,
  topic: 10,
  metadata: 10,
} as const;

/** The asset on its own — question 1. */
export function baseProvenance(a: NormalizedFootageAsset): { provenance: FootageProvenance; confidence: number } {
  if (a.provider === "user_upload" || a.provider === "url_import") {
    // Somebody handed it to us. Until a person says what it is, it is
    // unknown — never "real footage of the event" by default (§25).
    return { provenance: a.provenance && a.provenance !== "unknown" ? a.provenance : "unknown", confidence: a.provenance && a.provenance !== "unknown" ? Math.min(85, a.provenanceConfidence ?? 60) : 0 };
  }
  let c = 70;
  if (String(a.creator ?? a.credit ?? "").trim()) c += 5;
  if (a.sourceUrl) c += 5;
  if (a.filmingDate || a.publicationDate) c += 5;
  const provenance: FootageProvenance =
    a.mediaType === "image" ? "archival_photo" : a.origin === "generic" ? "real_stock" : "archival_footage";
  // Capped below the actual-footage threshold: a well-catalogued item is
  // evidence that it is a catalogued item, nothing more.
  return { provenance, confidence: Math.min(85, c) };
}

export interface ProvenanceAssessment {
  provenance: FootageProvenance;
  confidence: number;
  /** The match score, 0–100, before the threshold decides. */
  matchScore: number;
  signals: MatchSignals;
}

/** The asset for THIS scene — question 2. */
export function assessProvenance(
  r: FootageSearchRequest | null,
  a: NormalizedFootageAsset,
  signals?: MatchSignals,
): ProvenanceAssessment {
  const base = baseProvenance(a);
  if (!r) {
    return {
      provenance: base.provenance,
      confidence: base.confidence,
      matchScore: 0,
      signals: { event: "unknown", date: "unknown", location: "unknown", peopleOrgs: "unknown", topic: 0, metadataQuality: 0 },
    };
  }
  const s = signals ?? matchSignals(r, a);
  const W = PROVENANCE_WEIGHTS;
  let earned = 0;
  if (s.event === "yes") earned += W.event;
  if (s.date === "yes") earned += W.date;
  if (s.location === "yes") earned += W.location;
  if (s.peopleOrgs === "yes") earned += W.peopleOrgs;
  earned += Math.round(W.topic * s.topic);
  earned += Math.round(W.metadata * s.metadataQuality);
  // A signal the request cannot ask for is not held against the asset: a
  // scene that names no person or organisation has no people/org evidence
  // to find, so those ten points are taken out of the denominator rather
  // than silently failed. Event, date and place are never waived — without
  // them ACTUAL FOOTAGE is unreachable by the rule below, as it should be.
  const asksNames = (r.people?.length ?? 0) + (r.organizations?.length ?? 0) > 0;
  const applicable = W.event + W.date + W.location + W.topic + W.metadata + (asksNames ? W.peopleOrgs : 0);
  const score = Math.max(0, Math.min(100, Math.round((earned * 100) / applicable)));

  // An upload or an import stays unknown until a person says otherwise —
  // no amount of matching metadata promotes something nobody has vouched for.
  if (base.provenance === "unknown") {
    return { provenance: "unknown", confidence: 0, matchScore: score, signals: s };
  }

  const allThree = s.event === "yes" && s.date === "yes" && s.location === "yes";
  if (r.event && allThree && score >= ACTUAL_FOOTAGE_MIN_CONFIDENCE) {
    return { provenance: "actual_footage", confidence: score, matchScore: score, signals: s };
  }
  if (r.event) {
    // The scene named an event and this real asset is not proven to be it.
    // Illustrative: the honest word, and the one the watermark will print.
    return { provenance: "illustrative_footage", confidence: Math.max(base.confidence, score), matchScore: score, signals: s };
  }
  return { provenance: base.provenance, confidence: base.confidence, matchScore: score, signals: s };
}
