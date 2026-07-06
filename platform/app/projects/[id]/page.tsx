import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectScript, getScenes, type Scene } from "@/lib/data";
import SceneBoard from "@/components/SceneBoard";
import ScriptReview from "@/components/ScriptReview";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

// Pipeline position derived from scene states: images → video → assembly.
function pipeline(scenes: Scene[], projectDone: boolean) {
  const imagesApproved = scenes.filter((s) => s.imageApproved).length;
  const videosDone = scenes.filter((s) => s.videoUrl).length;
  const total = scenes.length || 1;
  const imagesDone = imagesApproved === total && total > 0;
  const videoDone = videosDone === total && total > 0;
  return [
    { name: "Script", state: "done" },
    { name: "Scenes", state: "done" },
    {
      name: imagesDone ? "Images" : `Images · ${imagesApproved}/${total}`,
      state: imagesDone ? "done" : "act",
    },
    {
      name: videoDone ? "Video" : `Video · ${videosDone}/${total}`,
      state: videoDone ? "done" : imagesDone ? "act" : "next",
    },
    { name: "Assembly", state: projectDone ? "done" : videoDone ? "act" : "next" },
  ];
}

export default async function ProductionRoom({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const scenes = await getScenes(id);
  const steps = pipeline(scenes, project.statusKind === "done");

  // Script review phase: no scenes exist yet and the project is waiting.
  const scriptPhase = scenes.length === 0 && project.statusKind !== "done";
  const script = scriptPhase ? await getProjectScript(id) : null;

  return (
    <main className="page">
      <AutoRefresh seconds={10} />
      <div className="room">
        <div className="crumb">
          <Link href="/">Projects</Link> / <b>{project.name}</b>
        </div>
        <div className="roomhead">
          <div>
            <h1>{project.name}</h1>
            <span className="sub">
              {project.lengthSeconds ? `${project.lengthSeconds} seconds · ` : ""}
              {scenes.length > 0 ? `${scenes.length} scenes · ` : ""}
              {project.status}
            </span>
          </div>
        </div>

        {project.finalVideoUrl && project.finalVideoUrl.startsWith("http") && (
          <div className="finalvideo">
            <video src={project.finalVideoUrl} controls preload="metadata" />
            <div className="vbar">
              <span>Final video</span>
              <a
                className="btn"
                href={project.finalVideoUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open / download
              </a>
            </div>
          </div>
        )}

        {scenes.length > 0 && (
          <div className="pipe">
            {steps.map((s, i) => (
              <span key={s.name} style={{ display: "contents" }}>
                <span className={`ps ${s.state}`}>
                  <span className="ic">{s.state === "done" ? "✓" : i + 1}</span>
                  {s.name}
                </span>
                {i < steps.length - 1 && <span className="pl" />}
              </span>
            ))}
          </div>
        )}

        {script && <ScriptReview projectId={id} script={script} />}

        {scenes.length > 0 ? (
          <SceneBoard projectId={id} scenes={scenes} />
        ) : !script ? (
          <div className="empty">
            <h3>Production is warming up</h3>
            <p>
              The script is being written. This page refreshes on its own —
              the review step appears here as soon as it&apos;s ready.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
