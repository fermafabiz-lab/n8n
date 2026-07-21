import { executionUrl, getExecutionError, getExecutions, n8nConfigured } from "@/lib/n8n";
import { stopExecutionAction } from "@/app/actions";

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
export default async function OpsPanel() {
  if (!n8nConfigured) {
    return (
      <div className="setupnote">
        <b>Production health is off.</b> Set <code>N8N_API_URL</code>{" "}
        (e.g. <code>https://fermafabiz.app.n8n.cloud/api/v1</code>) and{" "}
        <code>N8N_API_KEY</code> (n8n → Settings → n8n API) to see running
        executions, errors and the Stop button here.
      </div>
    );
  }

  let running: Awaited<ReturnType<typeof getExecutions>> = [];
  let failed: Awaited<ReturnType<typeof getExecutions>> = [];
  let apiError: string | null = null;
  try {
    [running, failed] = await Promise.all([
      getExecutions("running", 10),
      getExecutions("error", 5),
    ]);
  } catch (e) {
    apiError = String((e as Error).message ?? e);
  }

  // Only surface failures from the last 24h — older ones are history, not alerts.
  const recentFailed = failed.filter(
    (f) => f.startedAt && Date.now() - new Date(f.startedAt).getTime() < 24 * 3600 * 1000,
  );
  const withErrors = await Promise.all(
    recentFailed.map(async (f) => ({
      ...f,
      error: await getExecutionError(f.id),
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

  if (running.length === 0 && withErrors.length === 0) return null;

  return (
    <div style={{ marginBottom: 36, display: "flex", flexDirection: "column", gap: 14 }}>
      {running.length > 0 && (
        <div className="card">
          <h5>Running now</h5>
          {running.map((r) => (
            <div className="kv" key={r.id}>
              <span>
                <b style={{ color: "var(--ink)" }}>{r.workflowName}</b> · started{" "}
                {ago(r.startedAt)}
              </span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="chip run">running</span>
                <form action={stopExecutionAction}>
                  <input type="hidden" name="executionId" value={r.id} />
                  <button
                    className="abtn"
                    style={{
                      padding: "6px 14px",
                      fontSize: 12,
                      borderColor: "rgba(240,101,91,0.4)",
                      color: "#f5a8a2",
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
        <div className="card errcard">
          <h5>Recent errors (24h)</h5>
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
                        color: "var(--amber)",
                        background: "rgba(245,184,65,0.08)",
                        border: "1px solid rgba(245,184,65,0.25)",
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
      )}
    </div>
  );
}
