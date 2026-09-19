import Disclosure from "@/components/Disclosure";
import DeepSearchRerun from "@/components/DeepSearchRerun";
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
export default function DeepSearchPanel(props: DeepSearchInput & { projectId?: string }) {
  const { report, projectId } = props;
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

  // WHEN the report was written, and whether it read the finished script.
  // Both exist for one reason: the re-run answers `onReceived`, so pressing
  // the button does not change these numbers — the new report lands a minute
  // later. Without a timestamp the producer cannot tell the old report from
  // the new one, and the button reads as broken.
  const checkedAt = report?.checkedAt ? new Date(report.checkedAt) : null;
  const when =
    checkedAt && !Number.isNaN(checkedAt.getTime())
      ? checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;
  const readTheFinalScript = report?.scope === "final";

  const findings: DeepSearchFinding[] = Array.isArray(report?.findings) ? report!.findings! : [];
  const tone = deepSearchTone(state.status);

  // Counted here rather than trusted, because `sentences` only exists on
  // reports written after 2026-09-19 and an older film's panel must still add
  // up. `checked` has always counted statements; since the judge was taught to
  // rule on one assertion at a time, one sentence routinely yields several —
  // so the two numbers are said together or the producer reads "26 statements"
  // off a script that has thirteen sentences in it and concludes the panel is
  // lying.
  const sentenceCount =
    report?.sentences ?? new Set(findings.map((f) => (f.quote || "").trim()).filter(Boolean)).size;

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
        {when && (
          <span style={{ fontSize: 11, color: "var(--soft)", marginLeft: "auto" }}>
            {readTheFinalScript ? "Re-checked" : "Checked"} at {when}
          </span>
        )}
      </div>

      <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--soft)", lineHeight: 1.55 }}>
        {state.detail}
      </p>

      {report && (report.checked ?? 0) > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--soft)", lineHeight: 1.55 }}>
          {report.checked} statement{report.checked === 1 ? "" : "s"}
          {sentenceCount > 0 && sentenceCount < (report.checked ?? 0)
            ? ` across ${sentenceCount} sentence${sentenceCount === 1 ? "" : "s"}`
            : ""}{" "}
          were checked against this film&apos;s research
          {report.searched ? `, and ${report.searched} the research did not cover were looked up separately` : ""}.
          {(report.rewritten ?? 0) > 0 && (
            <>
              {" "}
              <b>
                The script below already contains {report.rewritten === 1 ? "the correction" : "the corrections"}
              </b>{" "}
              — read {report.rewritten === 1 ? "it" : "them"} before approving.
            </>
          )}
        </p>
      )}

      {/* The one thing the first pass could not tell you. Said only on a
          report that DID read the finished text, so it is a statement of fact
          about this report rather than a promise about the feature. */}
      {readTheFinalScript && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--soft)", lineHeight: 1.55 }}>
          This one read the script as it now stands — <b>the opening hook included</b>, and with
          any corrections already in place. The first pass runs before either exists.
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
              {groupBySentence(findings)
                // Problems first: a producer skimming this reads what is wrong,
                // not the roll call of everything that was fine.
                .sort((a, b) => rank(a[0]) - rank(b[0]))
                .map((group, i) => (
                  <Finding key={i} group={group} />
                ))}
            </ul>
          </Disclosure>
        </div>
      )}

      {projectId && <DeepSearchRerun projectId={projectId} />}
    </div>
  );
}

/**
 * ONE ENTRY PER SENTENCE, several assertions under it.
 *
 * The judge rules on one assertion at a time — that is the fix for the
 * compound sentence whose supported half hid its unsupported half, and it
 * means several findings now arrive carrying the SAME `quote`. Listed flat,
 * the producer would read the identical sentence three times and reasonably
 * assume the panel was repeating itself. Grouped, the repetition is what it
 * actually is: one sentence with three separate things wrong in it.
 *
 * Order within a group is kept as written, which is the order the judge
 * returned; the group takes the rank of its FIRST finding after the worst one
 * is floated to the front, so a sentence with one contradicted assertion sorts
 * as contradicted rather than hiding behind two supported ones.
 */
function groupBySentence(findings: DeepSearchFinding[]): DeepSearchFinding[][] {
  const byQuote = new Map<string, DeepSearchFinding[]>();
  const order: string[] = [];
  for (const f of findings) {
    const q = (f.quote || "").trim();
    if (!byQuote.has(q)) {
      byQuote.set(q, []);
      order.push(q);
    }
    byQuote.get(q)!.push(f);
  }
  return order.map((q) => [...byQuote.get(q)!].sort((a, b) => rank(a) - rank(b)));
}

function rank(f: DeepSearchFinding): number {
  if (f.verdict === "contradicted" && f.action !== "rewritten") return 0;
  if (f.action !== "kept" && f.action !== "rewritten") return 1;
  if (f.action === "rewritten") return 2;
  return 3;
}

function labelFor(f: DeepSearchFinding): { label: string; tone: string } {
  if (f.action === "rewritten") return { label: "CORRECTED", tone: "run" };
  if (f.action === "kept") return { label: "SOURCED", tone: "ok" };
  if (f.verdict === "contradicted") return { label: "CONTRADICTED", tone: "err" };
  return { label: "UNSUPPORTED", tone: "wait" };
}

function Finding({ group }: { group: DeepSearchFinding[] }) {
  const head = group[0];
  const allHeld = group.every((f) => f.action === "kept");

  return (
    <li style={{ borderLeft: "2px solid var(--line2)", paddingLeft: 12, opacity: allHeld ? 0.68 : 1 }}>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>&ldquo;{head.quote}&rdquo;</div>
      <ul style={{ listStyle: "none", margin: "7px 0 0", padding: 0, display: "grid", gap: 7 }}>
        {group.map((f, i) => {
          const { label, tone } = labelFor(f);
          return (
            <li key={i}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className={`chip ${tone}`} style={{ fontSize: 10 }}>
                  {label}
                </span>
                {/* The assertion, which is what distinguishes one finding from
                    the next when they share a sentence. Older reports have no
                    `claim`; they were one-per-sentence anyway, so the line is
                    simply left out. */}
                {f.claim && (
                  <span style={{ fontSize: 12, lineHeight: 1.5 }}>{f.claim}</span>
                )}
                {f.ref && <span style={{ fontSize: 11, color: "var(--soft)" }}>cites {f.ref}</span>}
              </div>
              {f.reason && (
                <div style={{ fontSize: 12, color: "var(--soft)", marginTop: 3, lineHeight: 1.5 }}>
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
        })}
      </ul>
    </li>
  );
}
