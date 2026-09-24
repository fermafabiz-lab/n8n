import {
  executionUrl,
  getExecutionError,
  getExecutions,
  getWorkflowMeta,
  isManualStop,
  n8nConfigured,
  getAliveProduction,
  getStalledProduction,
  STALL_AGE_MS,
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

/** Split the failure list on n8n's "cancelled manually" wording, tagging each row. */
function withStop<T extends { error: { message: string } | null }>(
  rows: T[],
  stoppedByHand: boolean,
): (T & { stoppedByHand: boolean })[] {
  return rows
    .filter((f) => isManualStop(f.error?.message) === stoppedByHand)
    .map((f) => ({ ...f, stoppedByHand }));
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
  // Names for the single-purpose workflows the static map does not carry,
  // and the throwaways hidden: a "zz …" workflow a session created, ran once
  // and archived is not production, and its one failed run was standing in
  // this list as a raw id nobody could place. An id the lookup cannot
  // resolve stays, shown as the id — unknown is never hidden.
  const named = (
    await Promise.all(
      withErrors.map(async (f) => {
        const meta = await getWorkflowMeta(f.workflowId).catch(() => null);
        if (meta?.throwaway) return null;
        return meta ? { ...f, workflowName: meta.name } : f;
      }),
    )
  ).filter((f): f is NonNullable<typeof f> => f !== null);
  // A stop by hand is not a failure. Pause, Stop and Delete on the site, and
  // n8n's own Stop button, end an execution with "cancelled manually" — and
  // the orchestrator that was waiting on it ends with status error and the
  // same words. Listed, because the producer may want to know something was
  // stopped, but neither red nor counted.
  const failures = withStop(named, false);
  const stopped = withStop(named, true);
  const rows = [...failures, ...stopped];

  if (apiError) {
    return (
      <div className="card errcard" style={{ marginBottom: 32 }}>
        <h5>Production health</h5>
        <p>Can&apos;t reach the n8n API: {apiError}</p>
      </div>
    );
  }

  if (running.length === 0 && stalled.length === 0 && rows.length === 0) return null;

  // ONE list of what is alive, with a long runner marked on its own row. It
  // used to be two cards: a red "Running unusually long" above "Running now",
  // and since every stalled execution is also a running one, the same run
  // was listed twice with two different Stop buttons — and the red card sat
  // flush against the stats block, the one thing on the page with no gap.
  // A long run is still a run: a Media Generation batch reads `running` for
  // hours in normal use — generating (16517: 1h46 straight on 2026-09-23) or
  // parked at an approval gate waiting on the producer — so "past 45 minutes"
  // fires on most real films and cannot be an alarm. The project page shows
  // only the long ones; the rest of the list is the dashboard's job.
  const longIds = new Set(stalled.map((s) => s.id));
  const live = errorsOnly
    ? stalled
    : [...running, ...stalled.filter((s) => !running.some((r) => r.id === s.id))];
  const longMins = Math.round(STALL_AGE_MS / 60000);

  return (
    // 18px on top is the gap the library toolbar keeps from the stats block
    // when there is no panel, so the rhythm is the same either way. The
    // project page wraps this in its own margin.
    <div
      style={{
        margin: errorsOnly ? "0 0 36px" : "18px 0 36px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {live.length > 0 && (
        <div className="card">
          <h5>{errorsOnly ? "Running unusually long" : "Running now"}</h5>
          {live.map((r) => {
            const long = longIds.has(r.id);
            return (
              <div className="kv" key={r.id}>
                <span>
                  <b style={{ color: "var(--ink)" }}>{r.workflowName}</b> · started{" "}
                  {ago(r.startedAt)}
                </span>
                {/* The name wraps, the controls never do: at 390px "running
                    long" and "■ Stop" were each breaking onto two lines. */}
                <span
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flex: "none",
                    marginLeft: 12,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    className={long ? "chip long" : "chip run"}
                    title={long ? `Running for more than ${longMins} minutes` : undefined}
                  >
                    {long
                      ? "running long"
                      : r.status === "waiting"
                        ? "working (in a wait step)"
                        : "running"}
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
            );
          })}
          {/* Advisory only: nothing the API exposes proves a long run is
              dead, so this says so and offers the Stop above rather than
              acting on the producer's behalf. Once, under the list. */}
          {live.some((r) => longIds.has(r.id)) && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--dim)" }}>
              <b style={{ color: "var(--amber)" }}>Running long</b> means past{" "}
              {longMins} minutes, and is usually still working — the clips of a
              ten-minute film alone take well over an hour, and a batch waiting
              at an approval gate stays running the whole time. n8n does
              occasionally create an execution and never run it, and that looks
              identical from here, so this is only a hint. If nothing has landed
              in a long while, stop it and press Resume: the batch skips
              whatever already has a clip, so nothing finished gets regenerated.
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        // Collapsed to one hairline by default: failures are usually already
        // dealt with, and the full red panel stood between the producer and
        // their projects on every visit.
        <Disclosure
          storageKey={errorsOnly ? "errors-project" : "errors-dash"}
          // "No failures" in red was an alarm about nothing: only stops by
          // hand were listed, and the row was red because the list used to
          // hold nothing else.
          calm={failures.length === 0}
          summary={
            <>
              <span className={failures.length ? "tdot red" : "tdot"} />
              {failures.length
                ? `${failures.length} failure${failures.length === 1 ? "" : "s"} in the last 24h`
                : "No failures in the last 24h"}
              {stopped.length > 0 && ` · ${stopped.length} stopped by hand`}
            </>
          }
        >
        <div className={failures.length ? "card errcard" : "card"}>
          {rows.map((f) => (
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
                  {f.stoppedByHand
                    ? "Stopped by hand — Pause, Stop or Delete on the site, or Stop in n8n. Not a failure: Resume picks the film up where it left off."
                    : (f.error?.message ?? "No details — open the execution in n8n.")}
                </span>
              </span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className={f.stoppedByHand ? "chip off" : "chip err"}>
                  {f.stoppedByHand ? "stopped" : "failed"}
                </span>
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
