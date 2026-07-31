import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectScriptInfo, getScenes, type Scene } from "@/lib/data";
import SceneBoard from "@/components/SceneBoard";
import ScriptReview from "@/components/ScriptReview";
import SceneReview from "@/components/SceneReview";
import AutoRefresh from "@/components/AutoRefresh";
import MediaPlayer from "@/components/MediaPlayer";
import StageChime from "@/components/StageChime";
import ResumeButton from "@/components/ResumeButton";
import AutoResume from "@/components/AutoResume";
import ExpandableTitle from "@/components/ExpandableTitle";
import OpsPanel from "@/components/OpsPanel";
import { getExecutions, n8nConfigured } from "@/lib/n8n";

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
  // 'rejected' means the producer asked for a rewrite and the workflow is
  // producing a new draft. The panel must stay on screen showing that state —
  // it used to vanish entirely, which read as the app losing the script.
  const scriptRewriting = scriptInfo?.status === "rejected";
  const script =
    scriptInfo &&
    (scriptInfo.status === "awaiting_approval" || scriptRewriting) &&
    scriptInfo.content
      ? scriptInfo
      : null;

  // Pause/Resume toggle state: is any production workflow running right now?
  let hasRunning = false;
  if (n8nConfigured) {
    try {
      hasRunning = (await getExecutions("running", 5)).length > 0;
    } catch {
      // n8n API unreachable — fall back to showing Resume.
    }
  }

  // Which gate (if any) is waiting on the user — drives the notification
  // chime when a generation step finishes and hands control back.
  const stage =
    project.statusKind === "err"
      ? "error"
      : project.statusKind === "done"
        ? "finished"
        : script
          ? "script-review"
          : scenes.length > 0 && scenes.some((s) => !s.sceneApproved)
            ? "scene-review"
            : scenes.some((s) => s.imageUrl && !s.imageApproved)
              ? "image-review"
              : scenes.some((s) => s.videoUrl && !s.videoApproved)
                ? "video-review"
                : "working";

  // Stalled: the pipeline should be producing (nothing waits on the user)
  // but no n8n execution is running and the project isn't finished.
  const stalled =
    n8nConfigured &&
    !hasRunning &&
    stage === "working" &&
    scenes.length > 0;

  return (
    <main className="page">
      <AutoRefresh seconds={10} />
      <StageChime
        items={[
          { key: id, stage },
          // Count items ding on every newly landed asset.
          { key: `${id}:scenes`, stage: `count:${scenes.length}` },
          { key: `${id}:images`, stage: `count:${scenes.filter((s) => s.imageUrl).length}` },
          { key: `${id}:clips`, stage: `count:${scenes.filter((s) => s.videoUrl).length}` },
        ]}
      />
      <AutoResume projectId={id} stalled={stalled} />
      <div className="room">
        <div className="crumb">
          <Link href="/">Projects</Link> /{" "}
          <b>{project.name.length > 60 ? project.name.slice(0, 60).trimEnd() + "…" : project.name}</b>
        </div>
        <div className="roomhead">
          <div>
            <ExpandableTitle text={project.name} as="h1" clampChars={110} />
            <span className="sub">
              {project.lengthSeconds ? `${project.lengthSeconds} seconds · ` : ""}
              {scenes.length > 0 ? `${scenes.length} scenes · ` : ""}
              {project.status}
            </span>
          </div>
          {project.statusKind !== "done" && scenes.length > 0 && (
            <ResumeButton projectId={id} running={hasRunning} />
          )}
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
          <ScriptReview
            projectId={id}
            scriptId={script.id}
            content={script.content}
            regenerating={scriptRewriting}
          />
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
        ) : null}

        {scenes.length > 0 && (
          <div style={{ marginTop: 24 }}>
            {/* Same failure list as the dashboard, so a broken generation
                is visible right where you're watching the scenes. */}
            <OpsPanel errorsOnly />
          </div>
        )}

        {scenes.length === 0 && !script ? (
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
