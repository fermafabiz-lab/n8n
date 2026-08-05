/**
 * Refusal notes → what actually happened and what to do next.
 *
 * The pipeline writes rejection reasons into "Observații Scenă", but a raw
 * PUBLIC_ERROR_* code turns a producer's next step into guesswork. This map
 * encodes the hard-won knowledge from CLAUDE.md — most importantly that
 * content refusals are DETERMINISTIC (the same input fails the same way, so
 * "try again" burns retries) and that Veo's people-filter is triggered by the
 * START IMAGE, not the prompt.
 *
 * Matching is deliberately loose (the notes are free text assembled by n8n),
 * and unknown notes return null — no advice beats wrong advice.
 */
export interface RefusalAdvice {
  cause: string;
  advice: string;
}

export function explainRefusal(note: string): RefusalAdvice | null {
  if (/PROMINENT_PEOPLE|prominent people/i.test(note)) {
    return {
      cause: "Veo refused the start image — almost always a visible face",
      advice:
        "Regenerate the image (people from behind, silhouettes, crowds at a distance). Rewording the prompt won't help: the image is the trigger, and an identical retry fails identically.",
    };
  }
  // Only the pipeline's literal code. A bare-word /\bminor\b/ matched
  // ordinary reviewer feedback ("minor issue with the last word" — and
  // Romanian "minoră", since \b splits at the diacritic) and told the
  // producer their image possibly showed a minor. No advice beats that.
  if (/MINOR_UPLOAD/i.test(note)) {
    return {
      cause: "Flow flagged the image as possibly showing a minor",
      advice:
        "The pipeline rewrites and retries on its own. If it keeps failing, regenerate the image with adults clearly framed — or nobody in frame at all.",
    };
  }
  if (/rate limit|quota|too many requests|HTTP ?429/i.test(note)) {
    return {
      cause: "Rate limit, not a content problem",
      advice: "Nothing wrong with the scene — it usually clears on the next batch run.",
    };
  }
  // The deterministic-refusal branch comes BEFORE the transient branch, and
  // the status-code patterns are anchored to an HTTP context: scene orders
  // here are chapter*100+scene, so "scene 503" is a real scene number in any
  // chapter-5 project — a bare \b5\d\d\b would have called a hard refusal
  // "transient" and advised the exact opposite of the right move.
  if (/REJECTED|AUTO-REWRITE|content policy|safety|refus/i.test(note)) {
    return {
      cause: "The generator refused this content",
      advice:
        "Refusals are deterministic — the same input fails the same way. Change the image or the wording before retrying.",
    };
  }
  if (/timed? ?out|ECONN|network|unreachable|HTTP ?5\d\d|status:? ?5\d\d/i.test(note)) {
    return {
      cause: "Transient service failure, not a refusal",
      advice: "Resume production and this scene will simply be retried.",
    };
  }
  return null;
}
