import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectScriptInfo, getScenes, type Scene } from "@/lib/data";
import { getCategory } from "@/lib/categories";
import { toneType } from "@/lib/tone-type";
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
import FinishedFlash from "@/components/FinishedFlash";
import OpsPanel from "@/components/OpsPanel";
import AssemblyStatus from "@/components/AssemblyStatus";
import SoundSettings from "@/components/SoundSettings";
import ProductionActivity from "@/components/ProductionActivity";
import { StageLink, StageNavProvider } from "@/components/StageNav";
import {
  executionUrl,
  getAliveProduction,
  getAssemblyState,
  n8nConfigured,
  FINAL_ASSEMBLY_WORKFLOW_ID,
  MEDIA_BATCH_CAP,
  type ExecutionSummary,
} from "@/lib/n8n";

export const dynamic = "force-dynamic";

// Pipeline position derived from scene states: images → video → assembly.
function pipeline(
  scenes: Scene[],
  projectDone: boolean,
  awaitingSettings: boolean,
  assembling: boolean,
  /** Silent film: nobody speaks, so there is no voice step to review. */
  silent: boolean,
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
  // A silent film never records anything, so the voice gate is not a step
  // it passes through — it is a step it does not have. Treating it as
  // "done" keeps every downstream state (Video, Final touches) correct
  // without special-casing each one.
  const audioDone = silent || (voicesApproved === total && total > 0);
  const videoDone = videosApproved === total && total > 0;
  // Which step is actually waiting on the producer, as opposed to how much
  // of the film is finished. Media generation runs a batch at a time (n8n
  // CAP=8) and its gates count only the batch's own scenes, so on a project
  // bigger than one batch the whole-project counts NEVER complete a step —
  // "Images · 8/15" stayed the active step forever while the thing actually
  // blocking production was an unapproved take. The fractions stay
  // project-wide (the film really does need all of them); only the "you are
  // here" marker follows the staged scenes.
  const staged = scenes.filter((s) => s.imageUrl);
  const stagedImages = staged.length > 0 && staged.every((s) => s.imageApproved);
  const stagedVoices = stagedImages && staged.every((s) => s.voiceApproved);
  // `name` is the stage, `note` is where that stage stands. They used to be
  // one string ("Images · 8/15"), which is the whole reason a step could only
  // ever be a pill — the stepper is cards now and the two lines are separate.
  // Both still come from this one function, so the cards, the fractions and
  // the progress bar cannot disagree with each other.
  return [
    { key: "script", name: "Script", note: "approved", state: "done" },
    {
      key: "scenes",
      name: "Scenes",
      note: scenesDone ? "approved" : `${scenesApproved}/${total}`,
      state: scenesDone ? "done" : "act",
    },
    {
      key: "images",
      name: "Images",
      note: imagesDone ? "approved" : `${imagesApproved}/${total}`,
      state: imagesDone ? "done" : scenesDone && !stagedImages ? "act" : "next",
    },
    // Dropped entirely for a silent film rather than shown green: an "Audio"
    // chip on a film with no narration is a step the producer keeps clicking
    // into to find nothing.
    ...(silent
      ? []
      : [
          {
            key: "audio",
            name: "Audio",
            note: audioDone ? "approved" : `${voicesApproved}/${total}`,
            state:
              audioDone ? "done" : stagedImages && !stagedVoices ? "act" : "next",
          },
        ]),
    {
      key: "video",
      name: "Video",
      note: videoDone ? "approved" : `${videosApproved}/${total}`,
      state: videoDone ? "done" : stagedVoices ? "act" : "next",
    },
    {
      // Its own step, because it is the one place the pipeline stops and
      // waits on a decision that isn't an approval.
      key: "final",
      name: "Final touches",
      note:
        projectDone || assembling
          ? "confirmed"
          : awaitingSettings || videoDone
            ? "needs you"
            : "queued",
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
      note: projectDone ? "finished" : assembling ? "rendering" : "queued",
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
  // Cinematic and anything else marked noNarration: no TTS ever runs, so
  // every voice gate on this page has to be treated as already passed.
  const silent = getCategory(project.category).noNarration === true;
  const steps = pipeline(
    scenes,
    project.statusKind === "done",
    project.awaitingFinalSettings,
    assembling,
    silent,
  );
  // Progress for the header bar. Deliberately a count of pipeline() STATES
  // rather than a second traversal of the scenes: any other derivation could
  // drift from the cards, and a bar that disagrees with the stepper it sits
  // above is worse than no bar. Silent films have six stages, not seven, so
  // the denominator is the list's own length.
  const stepsDone = steps.filter((s) => s.state === "done").length;

  // Whether the voice gate is on the page. Computed once because SceneBoard
  // needs the same answer: it owns the image and video steps only, and may
  // hand a scene to the audio step just when this panel is there to catch it.
  //
  // Scoped to the scenes that HAVE a picture, never to the whole project.
  // n8n runs media generation in batches (Sort & Cap, CAP=8) and every gate
  // in it — `Evaluate Image Approval`, `Evaluate Voice Approval` — counts
  // only the scenes of the current batch. A project bigger than one batch
  // therefore always has scenes with nothing generated yet, and requiring
  // `scenes.every(imageApproved)` made this panel unreachable for them: the
  // producer could never approve the takes, so the batch sat at its voice
  // gate forever and production looked frozen with no error anywhere.
  // "Every image that exists is signed off" is the same question the batch
  // asks, expressed in what the site can see.
  const withImage = scenes.filter((s) => s.imageUrl);
  const audioPanel =
    scenes.length > 0 &&
    // A silent film has no takes to review, and its scenes are created with
    // the voice already approved — the panel would be an empty gate the
    // producer cannot pass.
    !silent &&
    showing(
      "audio",
      scenes.every((s) => s.sceneApproved) &&
        withImage.length > 0 &&
        withImage.every((s) => s.imageApproved) &&
        withImage.some((s) => !s.voiceApproved),
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
  // Approval is final for the script, unlike every per-scene step. The whole
  // film is derived from this text — chapters, scenes, narration, image
  // prompts — so editing it after the fact would describe a film that no
  // longer exists. Past this point the panel is a read-only record of what
  // production was built from; redoing it means `restart-scripting`, which
  // rewrites the scenes too.
  //
  // ONLY "approved" locks. An unknown or empty status has to leave the gate
  // usable: freezing a script nobody signed off would strand the pipeline
  // with no door at all, which is far worse than an extra Approve button.
  const scriptLocked = scriptInfo?.status === "approved";
  const script =
    scriptInfo &&
    (scriptInfo.status === "awaiting_approval" ||
      scriptRewriting ||
      viewing === "script") &&
    scriptInfo.content
      ? scriptInfo
      : null;

  // What production is doing right now — drives Pause/Resume and the
  // activity panel. null = the n8n API didn't answer (distinct from "nothing
  // is running", which the panel is allowed to act on).
  let aliveNow: ExecutionSummary[] | null = null;
  if (n8nConfigured) {
    try {
      // Alive = really working (zombie-filtered) — see getAliveProduction.
      aliveNow = await getAliveProduction();
    } catch {
      // n8n API unreachable — fall back to showing Resume.
    }
  }
  const hasRunning = (aliveNow?.length ?? 0) > 0;

  // The render reports nothing while it works, so the page asks n8n directly
  // whether it is alive.
  const assembly =
    assembling && !project.finalVideoUrl
      ? await getAssemblyState().catch(() => null)
      : null;

  /**
   * A render is genuinely alive in n8n, so the stepper holds still.
   *
   * Not because looking at another step could interrupt anything — the render
   * runs in n8n and on Railway and does not care what is on screen. It is
   * that `confirmFinalSettings` fires the assemble webhook ITSELF, so walking
   * back to Final touches and pressing render again starts a second execution
   * and both write `Link Video Final` on the same project. "Stop the render"
   * is the way out, and it is the same button that makes going back safe.
   *
   * Keyed on `assembly.running` rather than on the status, so the two states
   * that are NOT a live render unlock by themselves: the gap where production
   * is still upstream (nothing to protect yet) and a render that failed or
   * vanished (its panel then offers Restart and the door back).
   */
  const renderLocked = !!assembly?.running;

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
              : !silent &&
                  scenes.some((s) => s.voiceUrl) &&
                  scenes.some((s) => !s.voiceApproved)
                ? "voice-review"
              : scenes.some((s) => s.videoUrl && !s.videoApproved)
                ? "video-review"
                : "working";

  // Which half of the pipeline the project is in. Before any scene exists it
  // is still being WRITTEN, and the two halves restart through different
  // doors — production resumes at media generation, which has nothing to do
  // when there are no scenes yet.
  const writing = scenes.length === 0 || scenes.every((s) => !s.sceneApproved);

  // Stalled: the pipeline should be producing (nothing waits on the user)
  // but no n8n execution is running and the project isn't finished. A project
  // in its first couple of minutes is excluded — scripting takes a moment to
  // spawn its execution, and a watchdog that fires into that gap would
  // restart the writing of a project that was never broken.
  const settledIn =
    !project.updatedAt || Date.now() - new Date(project.updatedAt).getTime() > 2 * 60_000;
  const stalled = n8nConfigured && !hasRunning && stage === "working" && settledIn;

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
      {/* Mounted on every visit (not just when finished): it has to see the
          project unfinished first, or it could never tell "just landed" from
          "was always done". */}
      <FinishedFlash
        projectId={id}
        finished={!!project.finalVideoUrl && project.finalVideoUrl.startsWith("http")}
      />
      {/* The stepper and the scene board share a guess about which step the
          producer just clicked, so the switch happens on the click rather
          than when the server round-trip lands. */}
      <StageNavProvider current={viewing}>
      <div className="room">
        {/* Breadcrumb + live status in one tracked line; the name itself is
            the title right below, not crumb text. */}
        <div className="wk-shell">
          <div className="arc wk-arc" aria-hidden />
          <div className="wk-head">
            <div className="wk-id">
              <div className="eyebrow" style={{ marginBottom: 16 }}>
                <Link href="/projects">Projects</Link>
                <span style={{ color: "var(--dim)" }}>/</span>
                {/* The status as a pill with a dot that pulses only while
                    something is moving. It replaced a bare ● in the crumb
                    line: same information, but it now reads as the state of
                    the film rather than as punctuation. */}
                <span className={`wk-state ${project.statusKind}`}>
                  <span className="wk-dot" />
                  {project.status}
                </span>
              </div>
              {/* The title wears the film's own typeface for this tone — the
                  same face the hook and chapter cards will render in. */}
              <ExpandableTitle
                text={project.name}
                as="h1"
                clampChars={110}
                className={`ptitle ${toneType(project.tone).className}`}
                style={
                  toneType(project.tone).uppercase
                    ? { textTransform: "uppercase" }
                    : undefined
                }
              />
              <div className="specs">
                {project.category && <span>{getCategory(project.category).label}</span>}
                {project.lengthSeconds && <span>{project.lengthSeconds}s</span>}
                {scenes.length > 0 && <span>{scenes.length} scenes</span>}
                <span>{project.aspect}</span>
                {project.tone && <span>{project.tone}</span>}
              </div>
            </div>
            <div className="wk-side">
              {/* Counted off the same pipeline() states the stepper draws, so
                  the bar can never claim a stage the cards do not show as
                  done. Only shown once there are scenes: before that every
                  stage but Script is unknowable and a 1/7 bar on a project
                  still being written reads as progress that has stalled. */}
              {scenes.length > 0 && (
                <div className="wk-prog">
                  <span className="lbl">
                    {stepsDone}/{steps.length} stages done
                  </span>
                  <span className="wk-bar">
                    <i style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
                  </span>
                </div>
              )}
              {project.statusKind !== "done" && (
                <ResumeButton
                  projectId={id}
                  running={hasRunning}
                  phase={writing ? "scripting" : "production"}
                  hasScenes={scenes.length > 0}
                />
              )}
            </div>
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
              {/* The narration on its own, from the same route the Voice
                  review panel links to. Repeated here because that panel is
                  several clicks away once a film is finished, and this is
                  where a producer stands when they want the audio. Silent
                  films have no takes to bundle. */}
              {!silent && scenes.some((s) => s.voiceUrl) && (
                <a className="btn" href={`/api/audio-bundle?project=${id}&chapter=all`} download>
                  ⤓ Narration
                </a>
              )}
            </div>
            <SoundSettings
              projectId={id}
              initialSfx={project.editing.sfx}
              initialMusic={project.editing.music}
              initialSpeed={project.editing.speed}
            />
          </div>
        )}

        {scenes.length > 0 && (
          <div className="pipe">
            {steps.map((s, i) => {
              // While a render is alive every step but Assembly stops being a
              // link — see renderLocked. Assembly itself stays reachable so
              // the producer can always get back to the panel that stops it.
              const frozen = renderLocked && s.key !== "assembly";
              const cls = `ps ${s.state}${viewing === s.key ? " sel" : ""}${frozen ? " frozen" : ""}`;
              /* Each step is a link to itself: that is the whole way back to an
                 earlier stage. The active one links to the bare page so
                 clicking it again returns to "whatever is live now".

                 The `display: contents` wrapper this used to need is gone with
                 the .pl connector it existed to carry — the card IS the flex
                 item now, so a wrapper would have to opt out of the layout to
                 stay harmless. */
              return (
                <Fragment key={s.key}>
                  {frozen ? (
                    <span
                      className={cls}
                      aria-disabled="true"
                      title="Locked while the final render is running — stop the render to go back"
                    >
                      <span className="ic">{s.state === "done" ? "✓" : i + 1}</span>
                      <span className="ps-name">{s.name}</span>
                      <span className="ps-note">{s.note}</span>
                    </span>
                  ) : (
                    <StageLink
                      stage={viewing === s.key ? null : s.key}
                      href={
                        viewing === s.key
                          ? `/projects/${id}`
                          : `/projects/${id}?stage=${s.key}`
                      }
                      className={cls}
                    >
                      <span className="ic">{s.state === "done" ? "✓" : i + 1}</span>
                      <span className="ps-name">{s.name}</span>
                      <span className="ps-note">{s.note}</span>
                    </StageLink>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        {renderLocked ? (
          <div className="setupnote" style={{ marginBottom: 20 }}>
            The final render is running, so the other steps are locked — going
            back and pressing render again would start a second one. Stop it
            below to change anything.
          </div>
        ) : (
          // Not shown for Assembly while it IS the live step: the pipeline is
          // there, so calling it "an earlier step" would be a lie.
          viewing &&
          !(viewing === "assembly" && assembling) && (
            // Without this the page just looks stale: the panel on screen is
            // not the one the pipeline is waiting on, and nothing said so.
            <div className="setupnote" style={{ marginBottom: 20 }}>
              Looking back at an earlier step. Production carries on in the
              background — regenerating anything here still works.{" "}
              <Link href={`/projects/${id}`}>Back to the live step</Link>
            </div>
          )
        )}

        {showing("script", !!script) && script && (
          <ScriptReview
            projectId={id}
            scriptId={script.id}
            content={script.content}
            regenerating={scriptRewriting}
            locked={scriptLocked}
          />
        )}

        {showing("final", project.awaitingFinalSettings) && (
          <FinalSettings projectId={id} initial={project.editing} silent={silent} />
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
            // Only a real verdict counts as missing. `!assembly.running`
            // also covered "production is still upstream" — n8n's deliberate
            // no-verdict answer — which is what kept the false restart
            // button on screen.
            missing={!!assembly?.stopped}
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

        {/* Live production activity: shown once media generation is the
            phase (every scene approved) and until production hands over to
            final settings/assembly. Answers what the batch is doing, whether
            anything was refused, and how much tail is beyond the batch cap. */}
        {scenes.length > 0 &&
          scenes.every((s) => s.sceneApproved) &&
          !project.awaitingFinalSettings &&
          !assembling &&
          project.statusKind !== "done" && (
            <ProductionActivity
              projectId={id}
              alive={aliveNow}
              scenes={scenes}
              cap={MEDIA_BATCH_CAP}
              silent={silent}
            />
          )}

        {/* Voice gate: images are signed off, so synthesis is the current
            step — the panel appears as soon as the pipeline reaches it, even
            before the first take exists, otherwise the stepper points at an
            "Audio" stage with nothing under it. */}
        {audioPanel && (
          <AudioReview
            projectId={id}
            projectName={project.name}
            scenes={scenes}
            mode={project.multiVoiceMode}
            language={project.language}
            narratorVoice={project.narratorVoice}
            cast={project.cast}
            castAssign={project.castAssign}
            chapterVoices={project.chapterVoices}
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
            projectName={project.name}
            scenes={scenes}
            portrait={project.aspect === "9:16"}
            // Which step the producer is actually looking at. Without it the
            // monitor always played the clip once one existed, so stepping
            // back to Images showed a video player instead of the image being
            // reviewed.
            focus={viewing === "images" ? "images" : viewing === "video" ? "video" : null}
            // On the live page the board picks the step itself, and it may
            // only pick "audio" when the panel that serves it is rendered.
            audioPanel={audioPanel}
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
      </StageNavProvider>
    </main>
  );
}
