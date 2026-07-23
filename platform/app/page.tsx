import { getProjects, isConfigured } from "@/lib/data";
import AutoRefresh from "@/components/AutoRefresh";
import OpsPanel from "@/components/OpsPanel";
import StageChime from "@/components/StageChime";
import ProjectsGrid from "@/components/ProjectsGrid";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const projects = await getProjects();
  const waiting = projects.filter((p) => p.statusKind === "wait");
  const running = projects.filter((p) => p.statusKind === "run").length;
  const finished = projects.filter((p) => p.statusKind === "done").length;

  const heroLine =
    waiting.length === 1
      ? `${waiting[0].name} is waiting on you.`
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
        <h1>
          Welcome back.
          <br />
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
        <div className="stat">
          <small>Total projects</small>
          <b>{projects.length}</b>
        </div>
      </div>

      <OpsPanel />

      {projects.length === 0 ? (
        <>
          <div className="sechead">
            <h2>Projects</h2>
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
