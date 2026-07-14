import Link from "next/link";
import { getProjects, isConfigured, type Project } from "@/lib/data";
import AutoRefresh from "@/components/AutoRefresh";
import OpsPanel from "@/components/OpsPanel";

export const dynamic = "force-dynamic";

function badgeLabel(p: Project): string {
  switch (p.statusKind) {
    case "wait":
      return "Needs review";
    case "run":
      return "Rendering";
    case "done":
      return "Finished";
    case "err":
      return "Needs a fix";
    default:
      return p.status;
  }
}

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

      <div className="sechead">
        <h2>Projects</h2>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <h3>No projects yet</h3>
          <p>Projects created through the n8n form will appear here.</p>
        </div>
      ) : (
        <div className="projects">
          {projects.map((p, i) => (
            <Link href={`/projects/${p.id}`} className="proj" key={p.id}>
              <div className="cover">
                <div className={`art fallback${(i % 4) + 1}`} />
                <span className={`badge ${p.statusKind === "idle" ? "run" : p.statusKind}`}>
                  {badgeLabel(p)}
                </span>
              </div>
              <div className="body">
                <h3>{p.name}</h3>
                <div className="meta">
                  {p.lengthSeconds ? `${p.lengthSeconds}s` : "—"}
                  {p.tone ? ` · ${p.tone}` : ""}
                </div>
                <div className="track">
                  <i
                    className={p.statusKind === "idle" ? "" : p.statusKind}
                    style={{ width: `${Math.round(p.progress * 100)}%` }}
                  />
                </div>
                <div className="foot">
                  <span>{p.status}</span>
                  <span className="go">Open →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
