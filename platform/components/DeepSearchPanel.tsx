import Disclosure from "@/components/Disclosure";
import { deepSearchState, deepSearchTone, type DeepSearchInput } from "@/lib/deep-search";
import type { DeepSearchFinding } from "@/lib/data";

/**
 * What Deep Search made of this script, shown above the script gate.
 *
 * IT NEVER BLOCKS. The producer's call was explicit — warn loudly, never stop
 * the approval — so this panel has no controls at all. It is a report on text
 * the producer is about to read anyway, and every sentence it names is still
 * in that text, editable in the box below.
 *
 * The verdict is NOT computed here. `lib/deep-search.ts` owns it, because the
 * same verdict is drawn on the Settings hub and in the Settings card, and a
 * light that is green in one place and red in another teaches the producer to
 * ignore all three.
 *
 * The state that MUST be said out loud is `corrected`: the rewrite lands
 * before segmentation, so by the time this page is on screen the text in the
 * box is not the text that was written, and nothing else would ever say so.
 * Each finding therefore shows the sentence AS IT STOOD — the new wording is
 * already in the textarea below, so the old one is the only way to see what
 * moved.
 */
export default function DeepSearchPanel(props: DeepSearchInput) {
  const { report } = props;
  const state = deepSearchState(props);

  // A documentary still being written has no news yet.
  if (state.status === "working") return null;

  // OFF IS A ONE-LINER, not a card. Every film now gets a report row — a
  // Story film's simply says "not documentary" — so without this, a grey
  // Deep Search card would sit above the script of every film that was never
  // going to be checked. The producer asked to see whether it is active; one
  // line answers that, and a card would just be in the way.
  //
  // A film with no row at all and no reason to have one (an older film, or
  // the Airtable backend) says nothing whatsoever.
  if (state.status === "off") {
    if (!report) return null;
    return (
      <div className="setupnote" style={{ marginBottom: 20 }}>
        <b>Deep Search: off.</b> {state.detail}
      </div>
    );
  }

  const findings: DeepSearchFinding[] = Array.isArray(report?.findings) ? report!.findings! : [];
  const tone = deepSearchTone(state.status);

  return (
    <div className={`card${state.red ? " errcard" : ""}`} style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className={`chip ${tone}`}>DEEP SEARCH</span>
        <strong style={{ fontSize: 14 }}>{state.label}</strong>
        {state.red && (
          <span style={{ fontSize: 12, color: "var(--red)", fontWeight: 650 }}>
            — this needs looking at
          </span>
        )}
      </div>

      <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--soft)", lineHeight: 1.55 }}>
        {state.detail}
      </p>

      {report && (report.checked ?? 0) > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--soft)", lineHeight: 1.55 }}>
          {report.checked} statement{report.checked === 1 ? "" : "s"} were checked against this film&apos;s
          research
          {report.searched ? `, and ${report.searched} the research did not cover were looked up separately` : ""}.
          {(report.rewritten ?? 0) > 0 && (
            <>
              {" "}
              <b>The script below already contains the corrections</b> — read them before approving.
            </>
          )}
        </p>
      )}

      {findings.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Disclosure
            storageKey="deepsearch"
            defaultOpen={state.status === "flagged"}
            summary={<span>{state.status === "flagged" ? "What is unsupported" : "What was checked"}</span>}
          >
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {[...findings]
                // Problems first: a producer skimming this reads what is wrong,
                // not the roll call of everything that was fine.
                .sort((a, b) => rank(a) - rank(b))
                .map((f, i) => (
                  <Finding key={i} f={f} />
                ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </div>
  );
}

function rank(f: DeepSearchFinding): number {
  if (f.verdict === "contradicted" && f.action !== "rewritten") return 0;
  if (f.action !== "kept" && f.action !== "rewritten") return 1;
  if (f.action === "rewritten") return 2;
  return 3;
}

function Finding({ f }: { f: DeepSearchFinding }) {
  const fixed = f.action === "rewritten";
  const held = f.action === "kept";
  const label = fixed
    ? "CORRECTED"
    : held
      ? "SOURCED"
      : f.verdict === "contradicted"
        ? "CONTRADICTED"
        : "UNSUPPORTED";
  const tone = fixed ? "run" : held ? "ok" : f.verdict === "contradicted" ? "err" : "wait";

  return (
    <li style={{ borderLeft: "2px solid var(--line2)", paddingLeft: 12, opacity: held ? 0.68 : 1 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className={`chip ${tone}`} style={{ fontSize: 10 }}>
          {label}
        </span>
        {f.ref && <span style={{ fontSize: 11, color: "var(--soft)" }}>cites {f.ref}</span>}
      </div>
      <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>&ldquo;{f.quote}&rdquo;</div>
      {f.reason && (
        <div style={{ fontSize: 12, color: "var(--soft)", marginTop: 5, lineHeight: 1.5 }}>
          {f.reason}
          {f.url && (
            <>
              {" "}
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="linkish">
                {f.source || "source"} ↗
              </a>
            </>
          )}
        </div>
      )}
    </li>
  );
}
