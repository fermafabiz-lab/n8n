import { getProjects, isConfigured, type StatusKind } from "@/lib/data";
import AutoRefresh from "@/components/AutoRefresh";
import OpsPanel from "@/components/OpsPanel";
import StageChime from "@/components/StageChime";
import ProjectsGrid from "@/components/ProjectsGrid";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const projects = await getProjects();
  const waiting = projects.filter((p) => p.statusKind === "wait");

  /**
   * Every project lands in exactly one bucket, and the buckets are counted
   * from the same list the grid shows — so the tiles always add up to the
   * total. They did not before: only running, waiting and finished had a
   * tile, so anything whose status the map does not recognise (a half-created
   * row, a status written by hand, a project abandoned before it started)
   * was counted in the total and shown nowhere. On the real base that was 47
   * of 98 projects, which read as the numbers being wrong.
   */
  const byKind: Record<StatusKind, number> = { run: 0, wait: 0, done: 0, err: 0, idle: 0 };
  for (const p of projects) byKind[p.statusKind] += 1;

  /** Shown only when they have something in them — an empty tile is noise. */
  const extraTiles: Array<{ label: string; n: number }> = [
    { label: "Needs a fix", n: byKind.err },
    // Deliberately vague, because it is: the grid's "Other" tab lists them
    // and every card there carries its own status text, which is the only
    // way to find out what these actually are.
    { label: "Other", n: byKind.idle },
  ].filter((t) => t.n > 0);

  const running = byKind.run;
  const finished = byKind.done;

  // Titles come from a free-text field and people paste whole prompts into it
  // (a ~3000-char master prompt has been seen in production). The hero sets
  // this in display type, so it has to be cut before it becomes the page.
  const short = (s: string, n = 42) =>
    s.length > n ? s.slice(0, n).trimEnd() + "…" : s;

  const heroLine =
    waiting.length === 1
      ? `${short(waiting[0].name)} is waiting on you.`
      : waiting.length > 1
        ? `${waiting.length} videos are waiting on you.`
        : running > 0
          ? "Everything is running on its own."
          : "All quiet on the production floor.";

  /**
   * "On the floor now" — the live panel. Real running projects, newest first,
   * capped at three because the panel is a glance, not a list; the toolbar
   * below is where you go through everything. `progress` is the same 0..1 the
   * cards use, so the two can never disagree.
   */
  const onFloor = projects.filter((p) => p.statusKind === "run").slice(0, 3);

  return (
    <main className="page pj">
      <AutoRefresh seconds={15} />
      <StageChime
        items={projects.map((p) => ({
          key: p.id,
          label: p.name,
          stage:
            p.statusKind === "done"
              ? "finished"
              : p.statusKind === "err"
                ? "error"
                : p.statusKind === "wait"
                  ? "needs-review"
                  : "working",
        }))}
      />
      <div className="pj-shell">
        <div className="arc" aria-hidden="true" />

        <div className="pj-hero">
          <div className="pj-welcome">
            <h1>Welcome back.</h1>
            <p className="lead">{heroLine}</p>
            <p className="sub">
              {waiting.length > 0
                ? "Open a project below to review and approve. Everything else keeps moving without you."
                : "Start a new video or check on a finished one."}
            </p>
            <span className="pj-gap" />
            <div className="pj-ctas">
              <Link href="/new" className="pj-cta">
                Start a video
              </Link>
              {/* Deep-links the library's own filter rather than being a
                  second, separate view of the same thing. */}
              <Link href="/projects?filter=wait" className="pj-ghost">
                Everything waiting on me
              </Link>
            </div>
          </div>

          <aside className="pj-live">
            <span className="lhead">
              <span className="k">On the floor now</span>
              <span className="auto">auto 15s</span>
            </span>
            {onFloor.length === 0 ? (
              <span className="lnote lempty">
                Nothing is rendering right now. Start a video and it will show
                up here while it runs.
              </span>
            ) : (
              onFloor.map((p) => (
                <div className="lrow" key={p.id}>
                  <span className="ltop">
                    <span className="lname">{short(p.name, 34)}</span>
                    <span className="lpct">{Math.round(p.progress * 100)}%</span>
                  </span>
                  <span className="lbar">
                    <i style={{ width: `${Math.round(p.progress * 100)}%` }} />
                    <i className="sheen" />
                  </span>
                  <span className="lstep">{p.status}</span>
                </div>
              ))
            )}
            <span className="lnote">
              {waiting.length > 0
                ? `${waiting.length} ${waiting.length === 1 ? "film needs" : "films need"} your review. The rest keeps moving while this tab is closed.`
                : "Nothing here needs you. The queue keeps moving while this tab is closed."}
            </span>
          </aside>
        </div>

        <div className="stats">
          <div className="stat">
            <small>In production</small>
            <b>{running}</b>
            <span className="note">
              {running > 0 ? "moving without you" : "nothing running"}
            </span>
          </div>
          <div className="stat">
            <small>Awaiting your review</small>
            {/* A zero here is good news, so it is set in the muted ink rather
                than full weight — the eye should not stop on it. */}
            <b className={waiting.length === 0 ? "zero" : ""}>{waiting.length}</b>
            <span className="note">
              {waiting.length === 0 ? "nothing is blocked on you" : "waiting on a decision"}
            </span>
          </div>
          <div className="stat">
            <small>Finished</small>
            <b className={finished === 0 ? "zero" : ""}>{finished}</b>
            <span className="note">delivered</span>
          </div>
          {extraTiles.map((t) => (
            <div className="stat" key={t.label}>
              <small>{t.label}</small>
              <b className={t.n === 0 ? "zero" : ""}>{t.n}</b>
              <span className="note">
                {t.label === "Needs a fix" ? "stopped mid-run" : "status unrecognised"}
              </span>
            </div>
          ))}
          <div className="stat">
            <small>Total projects</small>
            <b>{projects.length}</b>
            <span className="note">all time</span>
          </div>
        </div>
      </div>

      {!isConfigured && (
        <div className="setupnote">
          <b>Demo data.</b> Set <code>AIRTABLE_API_KEY</code> and{" "}
          <code>AIRTABLE_BASE_ID</code> in the environment to connect the real
          production base — the page will switch over automatically.
        </div>
      )}

      <OpsPanel />

      {projects.length === 0 ? (
        <>
          <div className="eyebrow">
            <span>Projects</span>
            <span className="n">(00)</span>
          </div>
          <div className="empty">
            <h3>No projects yet</h3>
            <p>Projects created through the n8n form will appear here.</p>
          </div>
        </>
      ) : (
        <ProjectsGrid projects={projects} />
      )}

      <footer className="pj-foot">
        <span className="brandline">
          <span className="bmark" aria-hidden="true" />
          House of Videos
        </span>
        <span>
          {projects.length} {projects.length === 1 ? "project" : "projects"} · one house
        </span>
      </footer>
    </main>
  );
}
