import {
  executionUrl,
  getExecutionError,
  getExecutions,
  n8nConfigured,
  getAliveProduction,
  getStalledProduction,
} from "@/lib/n8n";
import { stopExecutionAction } from "@/app/actions";
import Disclosure from "@/components/Disclosure";

function ago(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/**
 * Production health: live n8n executions with a Stop button, plus the most
 * recent failures with their real error message — so nobody has to open the
 * n8n editor to know something broke.
 */
export default async function OpsPanel({
  errorsOnly = false,
}: {
  // Project pages embed just the failure list under the scene board;
  // the dashboard shows the full panel (running + stop + setup note).
  errorsOnly?: boolean;
} = {}) {
  if (!n8nConfigured) {
    if (errorsOnly) return null;
    return (
      <div className="setupnote">
        <b>Production health is off.</b> Set <code>N8N_API_URL</code>{" "}
        (e.g. <code>https://your-n8n-host/api/v1</code>) and{" "}
        <code>N8N_API_KEY</code> (n8n → Settings → n8n API) to see running
        executions, errors and the Stop button here.
      </div>
    );
  }

  let running: Awaited<ReturnType<typeof getExecutions>> = [];
  let stalled: Awaited<ReturnType<typeof getExecutions>> = [];
  let failed: Awaited<ReturnType<typeof getExecutions>> = [];
  let apiError: string | null = null;
  try {
    // "waiting" = alive but paused in a Wait node (polling loops live there
    // most of the time). Hiding those made the panel claim nothing was
    // running while the Pause button correctly said otherwise.
    const [aliveNow, stalledNow, failedNow] = await Promise.all([
      errorsOnly ? Promise.resolve([]) : getAliveProduction(),
      getStalledProduction(),
      getExecutions("error", 5),
    ]);
    running = aliveNow;
    stalled = stalledNow;
    failed = failedNow;
  } catch (e) {
    apiError = String((e as Error).message ?? e);
  }

  // Only surface failures from the last 24h — older ones are history, not alerts.
  const recentFailed = failed.filter(
    (f) => f.startedAt && Date.now() - new Date(f.startedAt).getTime() < 24 * 3600 * 1000,
  );
  // Deliberately outside the try above, and therefore its own hazard: the
  // list call can succeed and this one still fail if n8n goes away in
  // between. Losing one error MESSAGE is worth a missing line; it is not
  // worth the page. `getExecutionError` no longer throws, and this catch is
  // the second lock on the same door.
  const withErrors = await Promise.all(
    recentFailed.map(async (f) => ({
      ...f,
      error: await getExecutionError(f.id).catch(() => null),
    })),
  );

  if (apiError) {
    return (
      <div className="card errcard" style={{ marginBottom: 32 }}>
        <h5>Production health</h5>
        <p>Can&apos;t reach the n8n API: {apiError}</p>
      </div>
    );
  }

  if (running.length === 0 && stalled.length === 0 && withErrors.length === 0) return null;

  return (
    <div style={{ marginBottom: 36, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* An execution running far past any plausible duration. Advisory only:
          nothing the API exposes proves it is dead, so this offers a Stop and
          says as much rather than acting on the producer's behalf. */}
      {stalled.length > 0 && (
        <div className="card errcard">
          <h5>Running unusually long</h5>
          {stalled.map((r) => (
            <div className="kv" key={r.id}>
              <span>
                <b style={{ color: "var(--ink)" }}>{r.workflowName}</b> · started{" "}
                {ago(r.startedAt)}, longer than a normal run
              </span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <form action={stopExecutionAction}>
                  <input type="hidden" name="executionId" value={r.id} />
                  <button className="abtn" style={{ padding: "6px 14px", fontSize: 12 }}>
                    ■ Stop it
                  </button>
                </form>
              </span>
            </div>
          ))}
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--dim)" }}>
            Usually still working — a big batch can take an hour. n8n does
            occasionally create an execution and never run it, and that looks
            identical from here, so this is only a hint. If nothing has landed
            in a long while, stop it and press Resume: the batch skips whatever
            already has a clip, so nothing finished gets regenerated.
          </p>
        </div>
      )}
      {!errorsOnly && running.length > 0 && (
        <div className="card">
          <h5>Running now</h5>
          {running.map((r) => (
            <div className="kv" key={r.id}>
              <span>
                <b style={{ color: "var(--ink)" }}>{r.workflowName}</b> · started{" "}
                {ago(r.startedAt)}
              </span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="chip run">
                  {r.status === "waiting" ? "working (in a wait step)" : "running"}
                </span>
                <form action={stopExecutionAction}>
                  <input type="hidden" name="executionId" value={r.id} />
                  <button
                    className="abtn"
                    style={{
                      padding: "6px 14px",
                      fontSize: 12,
                      borderColor: "rgba(216, 72, 61,0.4)",
                      color: "var(--red)",
                    }}
                  >
                    ■ Stop
                  </button>
                </form>
              </span>
            </div>
          ))}
        </div>
      )}

      {withErrors.length > 0 && (
        // Collapsed to one hairline by default: failures are usually already
        // dealt with, and the full red panel stood between the producer and
        // their projects on every visit.
        <Disclosure
          storageKey={errorsOnly ? "errors-project" : "errors-dash"}
          summary={
            <>
              <span className="tdot red" />
              {withErrors.length} failure{withErrors.length === 1 ? "" : "s"} in the
              last 24h
            </>
          }
        >
        <div className="card errcard">
          {withErrors.map((f) => (
            <div className="kv" key={f.id} style={{ alignItems: "flex-start" }}>
              <span style={{ maxWidth: "75%" }}>
                <b style={{ color: "var(--ink)" }}>{f.workflowName}</b>
                {f.error?.node && (
                  <>
                    {" "}
                    <span
                      style={{
                        fontFamily: "ui-monospace, Menlo, monospace",
                        fontSize: 11.5,
                        color: "var(--accent)",
                        background: "var(--accent-a08)",
                        border: "1px solid var(--accent-a28)",
                        borderRadius: 6,
                        padding: "1px 7px",
                      }}
                    >
                      node: {f.error.node}
                    </span>
                  </>
                )}{" "}
                · {ago(f.stoppedAt)}
                <br />
                <span style={{ fontSize: 12.5 }}>
                  {f.error?.message ?? "No details — open the execution in n8n."}
                </span>
              </span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="chip err">failed</span>
                {executionUrl(f.workflowId, f.id) && (
                  <a
                    className="abtn"
                    style={{ padding: "5px 12px", fontSize: 12, textDecoration: "none" }}
                    href={executionUrl(f.workflowId, f.id)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in n8n ↗
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
        </Disclosure>
      )}
    </div>
  );
}
