import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectScriptInfo, getScenes, type Scene } from "@/lib/data";
import SceneBoard from "@/components/SceneBoard";
import ScriptReview from "@/components/ScriptReview";
import SceneReview from "@/components/SceneReview";
import AutoRefresh from "@/components/AutoRefresh";
import MediaPlayer from "@/components/MediaPlayer";

export const dynamic = "force-dynamic";

// Pipeline position derived from scene states: images → video → assembly.
function pipeline(scenes: Scene[], projectDone: boolean) {
  const scenesApproved = scenes.filter((s) => s.sceneApproved).length;
  const imagesApproved = scenes.filter((s) => s.imageApproved).length;
  const videosDone = scenes.filter((s) => s.videoUrl).length;
  const total = scenes.length || 1;
  const scenesDone = scenesApproved === total && total > 0;
  const imagesDone = imagesApproved === total && total > 0;
  const videoDone = videosDone === total && total > 0;
  return [
    { name: "Script", state: "done" },
    {
      name: scenesDone ? "Scenes" : `Scenes · ${scenesApproved}/${total}`,
      state: scenesDone ? "done" : "act",
    },
    {
      name: imagesDone ? "Images" : `Images · ${imagesApproved}/${total}`,
      state: imagesDone ? "done" : scenesDone ? "act" : "next",
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

  // Script review phase: the Scripturi record is still awaiting approval.
  const scriptInfo =
    project.statusKind !== "done" ? await getProjectScriptInfo(id) : null;
  const script =
    scriptInfo && scriptInfo.status === "awaiting_approval" && scriptInfo.content
      ? scriptInfo
      : null;

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
            <div className="vwrap">
              <MediaPlayer
                url={project.finalVideoUrl}
                portrait={project.aspect === "9:16"}
                maxHeight={560}
              />
            </div>
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

        {script && (
          <ScriptReview projectId={id} scriptId={script.id} content={script.content} />
        )}

        {scenes.length > 0 && scenes.some((s) => !s.sceneApproved) ? (
          // Scene text review phase: scripts are split into scenes but not
          // all approved yet — media generation hasn't started.
          <SceneReview projectId={id} scenes={scenes} />
        ) : scenes.length > 0 ? (
          <SceneBoard
            projectId={id}
            scenes={scenes}
            portrait={project.aspect === "9:16"}
          />
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
