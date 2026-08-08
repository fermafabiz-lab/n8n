import { getProjects, isConfigured, type StatusKind } from "@/lib/data";
import AutoRefresh from "@/components/AutoRefresh";
import OpsPanel from "@/components/OpsPanel";
import StageChime from "@/components/StageChime";
import ProjectsGrid from "@/components/ProjectsGrid";

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

  return (
    <main className="page">
      <AutoRefresh seconds={15} />
      <StageChime
        items={projects.map((p) => ({
          key: p.id,
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
      <div className="hero">
        {/* The em is a block in CSS — the serif line breaks itself. */}
        <h1>
          Welcome back.
          <em>{heroLine}</em>
        </h1>
        <p>
          {waiting.length > 0
            ? "Open a project below to review and approve. Everything else keeps moving without you."
            : "Start a new video or check on a finished one."}
        </p>
      </div>

      {!isConfigured && (
        <div className="setupnote">
          <b>Demo data.</b> Set <code>AIRTABLE_API_KEY</code> and{" "}
          <code>AIRTABLE_BASE_ID</code> in the environment to connect the real
          production base — the page will switch over automatically.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <small>In production</small>
          <b>{running}</b>
        </div>
        <div className="stat">
          <small>Awaiting your review</small>
          <b>{waiting.length}</b>
        </div>
        <div className="stat">
          <small>Finished</small>
          <b>{finished}</b>
        </div>
        {extraTiles.map((t) => (
          <div className="stat" key={t.label}>
            <small>{t.label}</small>
            <b>{t.n}</b>
          </div>
        ))}
        <div className="stat">
          <small>Total projects</small>
          <b>{projects.length}</b>
        </div>
      </div>

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
    </main>
  );
}
