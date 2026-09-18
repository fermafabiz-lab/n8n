import Link from "next/link";
import { getDeepSearchHealth } from "@/lib/data";
import { deepSearchState, deepSearchTone } from "@/lib/deep-search";

export const dynamic = "force-dynamic";

/**
 * Deep Search, across every recent documentary that reached a script.
 *
 * This page exists because of one sentence from the producer: *"in the case
 * anything stops working I want the thing to become Red so I can tell you to
 * solve it."* A status that only lives on a film's own page is a status nobody
 * checks — it has to be somewhere you pass, and it has to be red from a
 * distance. So the Settings hub carries the dot and this page carries the
 * detail.
 *
 * It lists ONLY documentaries with a script, because that is the exact set of
 * films a report is due for. A story film is not a failure and does not belong
 * in a health check; a documentary still being written is not late yet.
 */
export default async function DeepSearchPage() {
  const films = await getDeepSearchHealth(20).catch(() => []);
  const rows = films.map((f) => ({
    ...f,
    state: deepSearchState({ report: f.report, isDocumentary: true, scriptExists: true }),
  }));
  const broken = rows.filter((r) => r.state.red);

  return (
    <main className="page admin settings">
      <Link href="/admin" className="sback">
        ← Settings
      </Link>
      <div className="sechead">
        <h2>Deep Search</h2>
        <p>
          Every documentary is checked against its own research before its script reaches you —
          statements the sources do not back are looked up, corrected where they can be, and reported
          where they cannot. It runs on Documentary films only, and it never blocks an approval.
        </p>
      </div>

      <div
        className={`setupnote${broken.length ? " errcard" : ""}`}
        style={{ marginBottom: 28 }}
      >
        {films.length === 0 ? (
          <>
            <b>Nothing to report yet.</b> No documentary has reached its script since Deep Search was
            switched on. The first one will appear here.
          </>
        ) : broken.length ? (
          <>
            <b style={{ color: "var(--red)" }}>
              {broken.length} film{broken.length === 1 ? "" : "s"} did not get checked.
            </b>{" "}
            {broken.length === 1 ? "This film is" : "These films are"} a documentary that reached a
            script with no Deep Search report, which means something in the chain did not run. Worth
            telling Claude about.
          </>
        ) : (
          <>
            <b>Deep Search is working.</b> The last {films.length} documentar
            {films.length === 1 ? "y" : "ies"} to reach a script {films.length === 1 ? "was" : "were"}{" "}
            all checked.
          </>
        )}
      </div>

      {/* Deliberately NOT `.plist`/`.ptitle`: those are the library's display
          rows and they set a film's name in the big display face, which reads
          as a heading rather than a line in a health check. */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/projects/${r.id}?step=script`}
              className={`card${r.state.red ? " errcard" : ""}`}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span className={`chip ${deepSearchTone(r.state.status)}`} style={{ flex: "none", marginTop: 1 }}>
                {r.state.label}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{r.name}</span>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--soft)", marginTop: 4, lineHeight: 1.5 }}>
                  {r.state.detail}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
