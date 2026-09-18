import Disclosure from "@/components/Disclosure";
import type { FactCheckReport, FactCheckFinding } from "@/lib/data";

/**
 * What the fact-checker made of this script, shown above the script gate.
 *
 * IT NEVER BLOCKS. The producer's call was explicit — warn loudly, never stop
 * the approval — so this panel has no buttons and no bearing on anything
 * downstream. It is a report on text the producer is about to read anyway,
 * and every sentence it names is still in that text, editable in the box
 * below.
 *
 * It renders in four shapes, because those are four different pieces of news
 * and flattening them into one is how a panel starts lying:
 *
 *   clean       every checkable statement held up. One green line.
 *   corrected   some did not, and the workflow already fixed them in the text
 *               the producer is looking at. This is the one that MUST be said
 *               out loud: the script on screen is not the one that was
 *               written, and nobody would otherwise know.
 *   flagged     some did not and they still stand. The list is the point.
 *   skipped     the check did not run — fiction, or no research pack. Not a
 *               pass; said in its own words so it cannot read as one.
 *
 * A null report draws NOTHING. Every film written before 2026-09-18 has one,
 * and "we never checked this" must not look like "this passed".
 */
export default function FactCheckPanel({ report }: { report: FactCheckReport | null }) {
  if (!report) return null;

  const findings = Array.isArray(report.findings) ? report.findings : [];
  const checked = report.checked ?? findings.length;
  const rewritten = report.rewritten ?? 0;
  // What still stands, as opposed to what was found: a sentence the rewrite
  // corrected is no longer a problem with the script on screen.
  const standing = findings.filter((f) => f.action !== "kept" && f.action !== "rewritten");

  if (report.skipped || checked === 0) {
    return (
      <div className="setupnote" style={{ marginBottom: 20 }}>
        <b>Not fact-checked.</b>{" "}
        {report.skipped ||
          "This script was not checked against sources."}
      </div>
    );
  }

  const tone = standing.length ? "wait" : "ok";
  const headline = standing.length
    ? rewritten
      ? `${rewritten} ${plural(rewritten, "sentence")} corrected, ${standing.length} still unsupported`
      : `${standing.length} of ${checked} ${plural(checked, "statement")} our sources do not back`
    : rewritten
      ? `${rewritten} ${plural(rewritten, "sentence")} corrected — the rest of the script checks out`
      : `All ${checked} checkable ${plural(checked, "statement")} check out`;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className={`chip ${tone}`}>FACT CHECK</span>
        <strong style={{ fontSize: 14 }}>{headline}</strong>
      </div>

      <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--soft)", lineHeight: 1.55 }}>
        {checked} {plural(checked, "statement")} in this narration were checked against the film&apos;s
        research pack
        {report.searched ? `, and ${report.searched} that the pack did not cover were looked up separately` : ""}.
        {rewritten > 0 && (
          <>
            {" "}
            <b>The script below already contains the corrections</b> — {rewritten}{" "}
            {plural(rewritten, "sentence")} {rewritten === 1 ? "was" : "were"} rewritten before you saw
            it. Read them before approving.
          </>
        )}
        {report.overwhelmed && (
          <>
            {" "}
            Too much of this narration went unsupported for a correction to be safe, so{" "}
            <b>nothing was changed</b> — at that volume a rewrite stops correcting the script and starts
            replacing it. The findings are below to judge by eye.
          </>
        )}
        {report.refused && !report.overwhelmed && (
          <>
            {" "}
            A correction was written and <b>rejected</b> ({report.refused}), so the script below is
            exactly as it was written.
          </>
        )}
      </p>

      {findings.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Disclosure
            storageKey="factcheck"
            defaultOpen={standing.length > 0}
            summary={
              <span>
                {standing.length
                  ? `${standing.length} unsupported ${plural(standing.length, "statement")}`
                  : "What was checked"}
              </span>
            }
          >
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {[...findings]
                // What still stands first: a producer skimming this reads the
                // problems, not the roll call of everything that was fine.
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

function rank(f: FactCheckFinding): number {
  if (f.verdict === "contradicted" && f.action !== "rewritten") return 0;
  if (f.action !== "kept" && f.action !== "rewritten") return 1;
  if (f.action === "rewritten") return 2;
  return 3;
}

function Finding({ f }: { f: FactCheckFinding }) {
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
    <li
      style={{
        borderLeft: "2px solid var(--line2)",
        paddingLeft: 12,
        opacity: held ? 0.68 : 1,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className={`chip ${tone}`} style={{ fontSize: 10 }}>
          {label}
        </span>
        {f.ref && (
          <span style={{ fontSize: 11, color: "var(--soft)" }}>cites {f.ref}</span>
        )}
      </div>
      <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
        {/* The sentence as it stood. On a corrected one this is what the text
            USED to say, which is the only way to see what changed — the new
            wording is in the script box below. */}
        &ldquo;{f.quote}&rdquo;
      </div>
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

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
