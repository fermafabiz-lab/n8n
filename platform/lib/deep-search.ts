import type { DeepSearchReport, DeepSearchFinding } from "@/lib/data";

/**
 * What Deep Search did to a film, as one verdict.
 *
 * ONE OWNER, because this is what the red light is wired to and it is read in
 * three places — the panel above the script gate, the Settings card, and the
 * dot on the Settings hub. Three copies of "is it broken?" would drift, and
 * the failure mode of drift here is the worst one available: a light that is
 * green somewhere and red somewhere else teaches the producer to ignore both.
 *
 * `red` is deliberately narrow. It means ONE thing: **this film asked for Deep
 * Search and did not get it.** It is not set for a film that was never meant
 * to be checked, and it is not set for a film that was checked and came back
 * with problems — that is the feature working, and colouring it red would
 * make the alarm meaningless within a week.
 */
export type DeepSearchStatus =
  /** Not a documentary, or a narration that turned out to be a story. Normal. */
  | "off"
  /** A documentary still being written — no report yet, and none due yet. */
  | "working"
  /** Ran; every checkable statement held up. */
  | "clean"
  /** Ran; corrected what it could, nothing left standing. */
  | "corrected"
  /** Ran; some statements still have nothing behind them. */
  | "flagged"
  /** Should have run and did not. THIS is the one that goes red. */
  | "broken";

export interface DeepSearchState {
  status: DeepSearchStatus;
  /** Two or three words for the chip. */
  label: string;
  /** One sentence a producer can act on. */
  detail: string;
  /** Tell someone. */
  red: boolean;
}

/** Skip codes that mean "it was asked for and did not happen". */
const FAULTS = new Set(["no-mode", "not-researched", "no-pack", "no-chapters", "unknown"]);

/**
 * When Deep Search first ran in production — the publish of Claude Scripting
 * `38d05de7`.
 *
 * A film whose script was written before this could not have a report, and
 * calling that a fault would light the alarm on history. It is a hardcoded
 * instant on purpose: the alternative is inferring the cutoff from the oldest
 * row in the table, which quietly moves every time an old project is deleted
 * and would eventually mark real faults as ancient history.
 *
 * The producer's own Google Maps film is exactly this case — a documentary
 * whose script was written at 13:24, an hour before the chain existed.
 */
export const DEEP_SEARCH_LIVE_AT = Date.parse("2026-09-18T14:31:00Z");

function predatesDeepSearch(createdAt?: string | null): boolean {
  if (!createdAt) return false; // unknown age is not an excuse
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t < DEEP_SEARCH_LIVE_AT;
}

export interface DeepSearchInput {
  report: DeepSearchReport | null;
  /** The project's category is `documentary`. */
  isDocumentary: boolean;
  /**
   * The script row exists, i.e. the film reached the approval gate.
   *
   * This is what makes "no report" a sound fault signal rather than a race:
   * `FC Save Report` runs BEFORE `Combine Chapters`, which runs before the
   * script row is written. So by the time a script exists, a documentary's
   * report exists too — or something went wrong.
   */
  scriptExists: boolean;
  /** The project's creation time, so films older than the feature are spared. */
  createdAt?: string | null;
}

export function deepSearchState({
  report,
  isDocumentary,
  scriptExists,
  createdAt,
}: DeepSearchInput): DeepSearchState {
  if (!report) {
    if (isDocumentary && predatesDeepSearch(createdAt)) {
      return {
        status: "off",
        label: "Before Deep Search",
        detail:
          "This film was written before Deep Search existed, so it was never checked. Re-writing the script would check it.",
        red: false,
      };
    }
    if (!isDocumentary) {
      return {
        status: "off",
        label: "Off",
        detail: "Deep Search runs on Documentary films. This one was made in another mode.",
        red: false,
      };
    }
    if (!scriptExists) {
      return {
        status: "working",
        label: "Working",
        detail: "Deep Search runs while the script is being written. Nothing to show yet.",
        red: false,
      };
    }
    return {
      status: "broken",
      label: "Did not run",
      detail:
        "This documentary reached its script without a Deep Search report. It should have one — something in the chain did not run.",
      red: true,
    };
  }

  const code = report.skipCode;
  if (code === "not-documentary") {
    return {
      status: "off",
      label: "Off",
      detail: report.skipped || "Deep Search runs on Documentary films only.",
      red: false,
    };
  }
  if (code === "story") {
    return {
      status: "off",
      label: "Nothing to check",
      detail:
        report.skipped ||
        "This narration tells a story rather than recounting real events, so there was nothing to check it against.",
      red: false,
    };
  }
  if (code && FAULTS.has(code)) {
    return {
      status: "broken",
      label: "Did not run",
      detail: report.skipped || "Deep Search did not run on this documentary.",
      red: true,
    };
  }
  // A skip code nobody has taught this function about is a fault, not a pass.
  // Erring the other way would let a future workflow silently turn the light
  // green by inventing a reason.
  if (code) {
    return {
      status: "broken",
      label: "Did not run",
      detail: report.skipped || `Deep Search did not run (${code}).`,
      red: true,
    };
  }

  const findings: DeepSearchFinding[] = Array.isArray(report.findings) ? report.findings : [];
  const checked = report.checked ?? findings.length;
  if (checked === 0) {
    return {
      status: "broken",
      label: "Found nothing",
      detail:
        "Deep Search ran on this documentary and came back with nothing at all — not even a statement it could check. That is a fault, not a clean bill.",
      red: true,
    };
  }

  // `cut` joins `kept` and `rewritten` as an action that RESOLVED a finding:
  // the sentence was a repeat of one the film already had, and it is gone. Left
  // out of this list it would read as a problem still standing, and a film that
  // was tidied would light the same warning as one that was not.
  const settled = new Set(["kept", "rewritten", "cut"]);
  const standing = findings.filter((f) => !settled.has(String(f.action))).length;
  const rewritten = report.rewritten ?? 0;
  const deduped = report.deduped ?? 0;
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  if (standing > 0) {
    return {
      status: "flagged",
      label: `${standing} unsupported`,
      detail: report.overwhelmed
        ? `Too much of this narration went unsupported for a correction to be safe, so nothing was changed. ${s(standing, "statement")} to judge by eye.`
        : // PAST THE SCRIPT GATE THE RE-RUN CHECKS AND REFUSES TO EDIT, because
          // the scenes carry their own copy of every line and their own
          // recordings by then. Said out loud, or a producer reading "3
          // unsupported" on an approved film waits for a correction that is
          // never coming.
          report.frozen
          ? `${s(standing, "statement")} have nothing behind ${standing === 1 ? "it" : "them"}. This film is past its script gate — the scenes already carry these lines — so nothing was changed for you; edit the scenes that say ${standing === 1 ? "it" : "them"}.`
          : report.refused
            ? `A correction was written and rejected (${report.refused}), so ${s(standing, "statement")} still stand as written.`
            : `${s(standing, "statement")} in this script have nothing behind ${standing === 1 ? "it" : "them"}.`,
      red: false,
    };
  }
  // A DELETION IS NEWS TOO, and it is different news from a correction: the
  // producer does not have to reread a sentence that is gone, but they should
  // know the film got shorter and why.
  const cutNote = deduped > 0 ? ` ${s(deduped, "sentence")} that repeated something said earlier ${deduped === 1 ? "was" : "were"} cut.` : "";

  if (rewritten > 0) {
    return {
      status: "corrected",
      label: `${s(rewritten, "fix")}`,
      detail: `Deep Search corrected ${s(rewritten, "sentence")} before you saw this script, and everything else checked out.${cutNote}`,
      red: false,
    };
  }
  if (deduped > 0) {
    return {
      status: "corrected",
      label: deduped === 1 ? "1 cut" : `${deduped} cut`,
      detail: `Every statement in this script is backed by the film's sources.${cutNote}`,
      red: false,
    };
  }
  return {
    status: "clean",
    label: "All checked",
    detail: `All ${s(checked, "statement")} in this script are backed by the film's sources.`,
    red: false,
  };
}

/** The chip class the shared stylesheet already defines. */
export function deepSearchTone(status: DeepSearchStatus): "ok" | "run" | "wait" | "err" | "idle" {
  switch (status) {
    case "broken":
      return "err";
    case "flagged":
      return "wait";
    case "corrected":
      return "run";
    case "clean":
      return "ok";
    default:
      return "idle";
  }
}
