import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectScriptInfo, getScenes, type Scene } from "@/lib/data";
import { getCategory } from "@/lib/categories";
import SceneBoard from "@/components/SceneBoard";
import ScriptReview from "@/components/ScriptReview";
import SceneReview from "@/components/SceneReview";
import AudioReview from "@/components/AudioReview";
import FinalSettings from "@/components/FinalSettings";
import AutoRefresh from "@/components/AutoRefresh";
import MediaPlayer from "@/components/MediaPlayer";
import StageChime from "@/components/StageChime";
import ResumeButton from "@/components/ResumeButton";
import AutoResume from "@/components/AutoResume";
import ExpandableTitle from "@/components/ExpandableTitle";
import OpsPanel from "@/components/OpsPanel";
import AssemblyStatus from "@/components/AssemblyStatus";
import {
  executionUrl,
  getAssemblyState,
  getExecutions,
  n8nConfigured,
  FINAL_ASSEMBLY_WORKFLOW_ID,
} from "@/lib/n8n";

export const dynamic = "force-dynamic";

// Pipeline position derived from scene states: images → video → assembly.
function pipeline(
  scenes: Scene[],
  projectDone: boolean,
  awaitingSettings: boolean,
  assembling: boolean,
) {
  const scenesApproved = scenes.filter((s) => s.sceneApproved).length;
  const imagesApproved = scenes.filter((s) => s.imageApproved).length;
  const voicesApproved = scenes.filter((s) => s.voiceApproved).length;
  // Every other step counts approvals, so this one must too — counting
  // clips that merely exist made "Video" tick green while they were all
  // still waiting to be reviewed.
  const videosApproved = scenes.filter((s) => s.videoApproved).length;
  const total = scenes.length || 1;
  const scenesDone = scenesApproved === total && total > 0;
  const imagesDone = imagesApproved === total && total > 0;
  const audioDone = voicesApproved === total && total > 0;
  const videoDone = videosApproved === total && total > 0;
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
      name: audioDone ? "Audio" : `Audio · ${voicesApproved}/${total}`,
      state: audioDone ? "done" : imagesDone ? "act" : "next",
    },
    {
      name: videoDone ? "Video" : `Video · ${videosApproved}/${total}`,
      state: videoDone ? "done" : audioDone ? "act" : "next",
    },
    {
      // Its own step, because it is the one place the pipeline stops and
      // waits on a decision that isn't an approval.
      name: "Final touches",
      state:
        projectDone || assembling
          ? "done"
          : awaitingSettings
            ? "act"
            : videoDone
              ? "act"
              : "next",
    },
    {
      name: "Assembly",
      state: projectDone ? "done" : assembling ? "act" : "next",
    },
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
  const assembling = /assembling/i.test(project.status);
  const steps = pipeline(
    scenes,
    project.statusKind === "done",
    project.awaitingFinalSettings,
    assembling,
  );

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

  // The render reports nothing while it works, so the page asks n8n directly
  // whether it is alive.
  const assembly =
    assembling && !project.finalVideoUrl
      ? await getAssemblyState().catch(() => null)
      : null;

  // Which gate (if any) is waiting on the user — drives the notification
  // chime when a generation step finishes and hands control back.
  const stage =
    project.statusKind === "err"
      ? "error"
      : project.statusKind === "done"
        ? "finished"
        : project.awaitingFinalSettings
          ? "final-settings"
          : script
          ? "script-review"
          : scenes.length > 0 && scenes.some((s) => !s.sceneApproved)
            ? "scene-review"
            : scenes.some((s) => s.imageUrl && !s.imageApproved)
              ? "image-review"
              : scenes.some((s) => s.voiceUrl) && scenes.some((s) => !s.voiceApproved)
                ? "voice-review"
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
              {project.category
                ? `${getCategory(project.category).icon} ${getCategory(project.category).label} · `
                : ""}
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

        {project.awaitingFinalSettings && (
          <FinalSettings projectId={id} initial={project.editing} />
        )}

        {assembling && !project.finalVideoUrl && (
          <AssemblyStatus
            projectId={id}
            startedAt={assembly?.running?.startedAt ?? null}
            failure={
              assembly?.failed?.detail
                ? {
                    message: assembly.failed.detail.message,
                    node: assembly.failed.detail.node,
                  }
                : null
            }
            missing={!!assembly && !assembly.running}
            n8nUrl={
              assembly?.running || assembly?.failed
                ? executionUrl(
                    FINAL_ASSEMBLY_WORKFLOW_ID,
                    (assembly.running ?? assembly.failed)!.id,
                  )
                : null
            }
          />
        )}

        {/* Voice gate: images are signed off, so synthesis is the current
            step — the panel appears as soon as the pipeline reaches it, even
            before the first take exists, otherwise the stepper points at an
            "Audio" stage with nothing under it. */}
        {scenes.length > 0 &&
          scenes.every((s) => s.sceneApproved) &&
          scenes.every((s) => s.imageApproved) &&
          scenes.some((s) => !s.voiceApproved) && (
            <AudioReview projectId={id} scenes={scenes} />
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
