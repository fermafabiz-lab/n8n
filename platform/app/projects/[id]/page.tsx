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
  getAliveProduction,
  getAssemblyState,
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
    { key: "script", name: "Script", state: "done" },
    {
      key: "scenes",
      name: scenesDone ? "Scenes" : `Scenes · ${scenesApproved}/${total}`,
      state: scenesDone ? "done" : "act",
    },
    {
      key: "images",
      name: imagesDone ? "Images" : `Images · ${imagesApproved}/${total}`,
      state: imagesDone ? "done" : scenesDone ? "act" : "next",
    },
    {
      key: "audio",
      name: audioDone ? "Audio" : `Audio · ${voicesApproved}/${total}`,
      state: audioDone ? "done" : imagesDone ? "act" : "next",
    },
    {
      key: "video",
      name: videoDone ? "Video" : `Video · ${videosApproved}/${total}`,
      state: videoDone ? "done" : audioDone ? "act" : "next",
    },
    {
      // Its own step, because it is the one place the pipeline stops and
      // waits on a decision that isn't an approval.
      key: "final",
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
      key: "assembly",
      name: "Assembly",
      state: projectDone ? "done" : assembling ? "act" : "next",
    },
  ];
}

const STAGE_KEYS = [
  "script",
  "scenes",
  "images",
  "audio",
  "video",
  "final",
  "assembly",
] as const;
type StageKey = (typeof STAGE_KEYS)[number];

export default async function ProductionRoom({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const { id } = await params;
  // Revisiting an earlier step. Without it the page shows only whatever the
  // pipeline is waiting on right now, which meant a project at "Final
  // touches" had no way back to its script. Absent => today's behaviour,
  // exactly: every panel keeps its own automatic condition.
  const stageParam = (await searchParams)?.stage;
  const viewing: StageKey | null = STAGE_KEYS.includes(stageParam as StageKey)
    ? (stageParam as StageKey)
    : null;
  const showing = (k: StageKey, auto: boolean) => (viewing ? viewing === k : auto);
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
  // Fetched for finished projects too, so the Script step stays readable
  // after the fact instead of the panel vanishing with the record.
  const scriptInfo =
    project.statusKind !== "done" || viewing === "script"
      ? await getProjectScriptInfo(id)
      : null;
  // 'rejected' means the producer asked for a rewrite and the workflow is
  // producing a new draft. The panel must stay on screen showing that state —
  // it used to vanish entirely, which read as the app losing the script.
  const scriptRewriting = scriptInfo?.status === "rejected";
  const script =
    scriptInfo &&
    (scriptInfo.status === "awaiting_approval" ||
      scriptRewriting ||
      viewing === "script") &&
    scriptInfo.content
      ? scriptInfo
      : null;

  // Pause/Resume toggle state: is any production workflow running right now?
  let hasRunning = false;
  if (n8nConfigured) {
    try {
      // Alive = really working (zombie-filtered) — see getAliveProduction.
      hasRunning = (await getAliveProduction()).length > 0;
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
              <span key={s.key} style={{ display: "contents" }}>
                {/* Each step is a link to itself: that is the whole way back
                    to an earlier stage. The active one links to the bare page
                    so clicking it again returns to "whatever is live now". */}
                <Link
                  href={
                    viewing === s.key
                      ? `/projects/${id}`
                      : `/projects/${id}?stage=${s.key}`
                  }
                  className={`ps ${s.state}${viewing === s.key ? " sel" : ""}`}
                  scroll={false}
                >
                  <span className="ic">{s.state === "done" ? "✓" : i + 1}</span>
                  {s.name}
                </Link>
                {i < steps.length - 1 && <span className="pl" />}
              </span>
            ))}
          </div>
        )}

        {viewing && (
          // Without this the page just looks stale: the panel on screen is
          // not the one the pipeline is waiting on, and nothing said so.
          <div className="setupnote" style={{ marginBottom: 20 }}>
            Looking back at an earlier step. Production carries on in the
            background — regenerating anything here still works.{" "}
            <Link href={`/projects/${id}`}>Back to the live step</Link>
          </div>
        )}

        {showing("script", !!script) && script && (
          <ScriptReview
            projectId={id}
            scriptId={script.id}
            content={script.content}
            regenerating={scriptRewriting}
          />
        )}

        {showing("final", project.awaitingFinalSettings) && (
          <FinalSettings projectId={id} initial={project.editing} />
        )}

        {showing("assembly", assembling && !project.finalVideoUrl) &&
          !project.finalVideoUrl && (
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
          showing(
            "audio",
            scenes.every((s) => s.sceneApproved) &&
              scenes.every((s) => s.imageApproved) &&
              scenes.some((s) => !s.voiceApproved),
          ) && (
            <AudioReview
              projectId={id}
              scenes={scenes}
              mode={project.multiVoiceMode}
              narratorVoice={project.narratorVoice}
              cast={project.cast}
              castAssign={project.castAssign}
            />
          )}

        {scenes.length > 0 &&
        showing("scenes", scenes.some((s) => !s.sceneApproved)) ? (
          // Scene text review phase: scripts are split into scenes but not
          // all approved yet — media generation hasn't started.
          <SceneReview projectId={id} scenes={scenes} />
        ) : scenes.length > 0 &&
          (!viewing || viewing === "images" || viewing === "video") ? (
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
