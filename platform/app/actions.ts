"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  isConfigured,
  writeProjectFields,
  writeSceneApproval,
  writeSceneFeedback,
  writeSceneScript,
  writeSceneFields,
  requestSceneRewrite,
  releaseSceneRewrite,
  readSceneNarration,
  readSceneVideoInputs,
  saveVersionOfScene,
  restoreVersionOfScene,
  getProject,
  findRecentProjectByName,
  writeScriptFields,
  requestVoiceRegen,
  deleteProjectDeep,
  updateEditingOptions,
} from "@/lib/data";
import {
  normalizeSfxLevel,
  normalizeSpeed,
  normalizeVoiceTone,
  type VoiceTone,
} from "@/lib/data/derive";
import {
  getAliveAssembly,
  getAliveProduction,
  getExecutions,
  getStalledProduction,
  stopExecution,
} from "@/lib/n8n";
import { getCategory } from "@/lib/categories";

export interface ActionResult {
  ok: boolean;
  message: string;
}

function friendlyError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (msg.includes("UNKNOWN_FIELD_NAME")) {
    return "Airtable is missing a field this button writes to (e.g. „Aprobare Video”/„Regenerează Video”). Create it in the Scene table with the exact name, then try again.";
  }
  if (msg.includes("403") || msg.includes("NOT_AUTHORIZED")) {
    return "The Airtable token can read but not write. Regenerate it with the data.records:write scope.";
  }
  return msg;
}

/**
 * Nudge a media-generation batch into existence, best effort.
 *
 * Video regeneration is the one regeneration with no webhook of its own: the
 * flag is only ever noticed by `Evaluate Video Approval`, which polls every
 * 15s from INSIDE a live media-generation execution. With no batch alive the
 * flag simply sits there, and the scene shows "Regenerating video…" forever.
 *
 * Best effort, and deliberately quiet about it: `getAliveProduction()` is
 * instance-wide, so another project's batch reads as "alive" here, and an
 * execution parked past the video gate (final settings, assembly) is alive
 * without polling for regenerations. Both cases return "alive" and start
 * nothing — which is why the flag also has a local exit in the UI.
 */
async function nudgeProduction(projectId: string): Promise<"alive" | "started" | "no"> {
  const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  const webhook =
    process.env.N8N_RESUME_WEBHOOK_URL ??
    newProject?.replace(/new-project\/?$/, "resume-project");
  if (!webhook?.includes("resume-project")) return "no";
  try {
    const alive = await getAliveProduction();
    if (alive.length > 0) return "alive";
    // Same housekeeping the Resume button does: executions n8n created but
    // never ran report as running forever and wedge their parent.
    for (const dead of await getStalledProduction().catch(() => [])) {
      await stopExecution(dead.id).catch(() => {});
    }
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? "started" : "no";
  } catch {
    // n8n unreachable — the flag is written either way, and the producer
    // still has Resume.
    return "no";
  }
}

/**
 * Ask for a new clip on a scene whose picture just changed.
 *
 * Guarded, because `Prep Video Regen` in Media Generation is `onError: null`:
 * it throws when the scene has no `Image Media ID` or no motion prompt, and a
 * throw there does not skip the scene — it kills the whole batch, including
 * the scenes it was busy generating. So the inputs are read before the flag
 * is written, never after.
 *
 * "none" = nothing to do: no clip yet, so the batch's own video loop
 * (`Needs Clip?`) will generate the first one from the approved image anyway.
 */
async function flagStaleClip(
  sceneId: string,
): Promise<"none" | "flagged" | "blocked"> {
  const inputs = await readSceneVideoInputs(sceneId).catch(() => null);
  if (!inputs?.hasClip) return "none";
  if (!inputs.hasImageMediaId || !inputs.hasMotionPrompt) return "blocked";
  // This path replaces a clip the producer never asked to lose — it fires
  // when an approved image made the existing clip stale — so it is the one
  // that most needs the outgoing clip kept.
  await autoKeep(sceneId, "video");
  await writeSceneApproval(sceneId, "video", "regenerate");
  return "flagged";
}

const BLOCKED_NOTE =
  " The clip still shows the old picture, but this scene has no Flow asset id or no motion prompt, so asking for a new one would stop the whole batch — redo the clip by hand from the Video step.";

/** Single-scene version: flag, then make sure something will pick it up. */
async function chainVideoRegen(
  projectId: string,
  sceneId: string,
): Promise<string | null> {
  const outcome = await flagStaleClip(sceneId);
  if (outcome === "none") return null;
  if (outcome === "blocked") return BLOCKED_NOTE;
  const where = await nudgeProduction(projectId);
  return where === "started"
    ? " The clip was built from the old picture, so a new one was queued and production restarted to pick it up."
    : " The clip was built from the old picture, so a new one was queued — a running batch picks it up within ~15s.";
}

/**
 * Keep the outgoing asset before anything replaces it.
 *
 * The manual button only helps the producer who remembers to press it, and
 * the moment you need a draft is exactly the moment you did not expect to —
 * so every path that replaces an image or a clip files one first. Already
 * saved assets are de-duplicated, so this stays quiet.
 *
 * Deliberately swallows its errors: this is a safety net, and a safety net
 * that can block the regeneration it protects is worse than none.
 */
async function autoKeep(sceneId: string, kind: "image" | "video"): Promise<void> {
  await saveVersionOfScene(sceneId, kind, { auto: true }).catch(() => {});
}

export async function sceneAction(
  projectId: string,
  sceneId: string,
  kind: "image" | "video",
  action: "approve" | "regenerate",
  feedback?: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written. Connect Airtable to make this real." };
  }
  try {
    if (action === "regenerate" && feedback?.trim()) {
      // n8n appends this to the generation prompt, then clears it.
      await writeSceneFeedback(sceneId, feedback.trim());
    }
    // Before the replacement is set in motion, not after: once n8n overwrites
    // the field the old asset is unreachable.
    if (action === "regenerate") await autoKeep(sceneId, kind);
    await writeSceneApproval(sceneId, kind, action);

    // Image regeneration runs on its own webhook, so it no longer depends on
    // a live media-generation execution being alive to notice the flag.
    // Video still rides the batch loop (it needs Flow + the mux server).
    if (action === "regenerate" && kind === "image") {
      const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
      const webhook =
        process.env.N8N_IMAGE_REGEN_WEBHOOK_URL ??
        newProject?.replace(/new-project\/?$/, "scene-image-regen");
      if (webhook?.includes("scene-image-regen")) {
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene_id: sceneId }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`n8n webhook: HTTP ${res.status}`);
      }
    }
    // Approving a picture that already has a clip means the clip is now made
    // from an image nobody approved. Nothing downstream ever compares the two
    // — the same silent drift the narration/take pair had — so the new clip is
    // asked for here rather than left to the producer to remember.
    const chained =
      kind === "image" && action === "approve"
        ? await chainVideoRegen(projectId, sceneId)
        : null;

    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        (action === "approve"
          ? `${kind === "image" ? "Image" : "Video"} approved.`
          : `Regeneration queued — n8n picks it up within ~15s.`) + (chained ?? ""),
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function regenerateVoice(
  projectId: string,
  sceneId: string,
  narration: string,
  /** Explicit voice for this one synthesis — wins over the mode's rule. */
  voiceId?: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    // Flag first — it drives the "Re-synthesizing…" badge, and n8n clears it.
    await requestVoiceRegen(sceneId, narration);

    // Then fire the standalone re-synthesis webhook, for the same reason as
    // the scene-text rewrite: relying on a long-lived media-generation
    // execution to notice the flag means the feature dies the moment that
    // execution is stopped or finishes.
    const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
    const webhook =
      process.env.N8N_VOICE_REGEN_WEBHOOK_URL ??
      newProject?.replace(/new-project\/?$/, "scene-voice-regen");
    if (webhook?.includes("scene-voice-regen")) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // voice_id, when present, overrides the mode's voice rule in n8n for
        // this one synthesis — it's the audio panel's per-scene voice choice.
        body: JSON.stringify(
          voiceId && voiceId.includes("_")
            ? { scene_id: sceneId, voice_id: voiceId }
            : { scene_id: sceneId },
        ),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`n8n webhook: HTTP ${res.status}`);
    }

    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Voice regeneration queued — a new take is synthesized in ~30-60s (the page refreshes itself).",
    };
  } catch (e) {
    const msg = friendlyError(e);
    if (msg.includes("UNKNOWN_FIELD_NAME")) {
      return {
        ok: false,
        message:
          "Airtable is missing the „Regenerează Voce” checkbox on the Scene table — create it, then try again.",
      };
    }
    return { ok: false, message: msg };
  }
}

export async function approveAllOfKind(
  projectId: string,
  sceneIds: string[],
  kind: "image" | "video",
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    let restaled = 0;
    let blocked = 0;
    for (const id of sceneIds) {
      await writeSceneApproval(id, kind, "approve");
      // Same rule as the single approve — a picture signed off under a clip
      // that was made from the previous one leaves the two disagreeing.
      // On the first pass through the pipeline no clip exists yet, so this
      // is a no-op for every scene and costs one read each.
      if (kind === "image") {
        const outcome = await flagStaleClip(id);
        if (outcome === "flagged") restaled++;
        if (outcome === "blocked") blocked++;
      }
      // Airtable rate limit is 5 req/s per base; n8n polls concurrently.
      await new Promise((r) => setTimeout(r, 250));
    }
    // Nudged once for the whole batch, not per scene: the poller regenerates
    // one scene per 15s cycle regardless, and each nudge costs n8n API calls.
    if (restaled > 0) await nudgeProduction(projectId);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        `Approved ${sceneIds.length} ${kind === "image" ? "images" : "videos"}.` +
        (restaled > 0
          ? ` ${restaled} clip${restaled === 1 ? " was" : "s were"} built from the old picture, so ${restaled === 1 ? "it is" : "they are"} being redone — one per ~15s.`
          : "") +
        (blocked > 0
          ? ` ${blocked} could not be queued (missing Flow asset id or motion prompt) — redo ${blocked === 1 ? "it" : "them"} from the Video step.`
          : ""),
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function saveSceneScript(
  projectId: string,
  sceneId: string,
  narration: string,
  imagePrompt: string,
  approve: boolean,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    // Read BEFORE writing: if this edit changes a line that has already been
    // read aloud, the existing take now says something else. The media batch
    // never re-records over an existing voiceover, and nothing compares the
    // two, so left alone the scene keeps a narration and an audio track that
    // disagree — visible only by listening to the whole film.
    const before = await readSceneNarration(sceneId).catch(() => null);
    const staleVoice =
      before !== null &&
      before.hasVoice &&
      narration.trim() !== "" &&
      narration.trim() !== before.narration.trim();

    // Same reasoning one step later: the picture was approved against the OLD
    // prompt, so a changed prompt means the sign-off was given for something
    // that is no longer what this scene asks for.
    const staleImage =
      before !== null &&
      before.imageApproved &&
      imagePrompt.trim() !== "" &&
      imagePrompt.trim() !== before.imagePrompt.trim();

    await writeSceneScript(sceneId, { narration, imagePrompt, approve });

    if (staleImage) {
      // The clip is built from the image, so it goes back for review too.
      await writeSceneFields(sceneId, {
        "Aprobare Imagine": false,
        "Aprobare Video": false,
      });
    }
    if (staleVoice) {
      // Same door the audio panel uses — saves the line and re-reads it.
      await regenerateVoice(projectId, sceneId, narration);
    }

    revalidatePath(`/projects/${projectId}`);
    const suffix =
      (staleImage
        ? " The image prompt changed, so the picture needs approving again."
        : "") +
      (staleVoice
        ? " The line changed after it had been recorded, so the voice is being read again."
        : "");
    return {
      ok: true,
      message:
        (approve
          ? "Scene approved — production continues once every scene is approved."
          : "Scene saved.") + suffix,
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Replace a scene's image prompt at the image-approval stage.
 *
 * n8n's regeneration reads "Imagine First Frame" for the new prompt, so a
 * rewritten prompt saved here is what actually gets rendered. Without this
 * the only lever at this stage was the free-text feedback box, and a fully
 * rewritten prompt pasted anywhere else silently never reached Airtable.
 */
export async function saveImagePrompt(
  projectId: string,
  sceneId: string,
  imagePrompt: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await writeSceneScript(sceneId, { imagePrompt });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: "Image prompt saved." };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Fire the standalone per-scene rewrite webhook.
 *
 * This used to rely on the scene-approval polling loop inside a live
 * scripting execution: once that execution was stopped or crashed, the flag
 * sat there forever and the feature was silently dead (Resume only restarts
 * media generation).
 */
async function fireSceneRewriteWebhook(sceneId: string): Promise<void> {
  const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  const webhook =
    process.env.N8N_SCENE_REGEN_WEBHOOK_URL ??
    newProject?.replace(/new-project\/?$/, "scene-text-regen");
  if (!webhook?.includes("scene-text-regen")) return;
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scene_id: sceneId }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`n8n webhook: HTTP ${res.status}`);
}

/**
 * Replace what the clip DOES — the direction Veo is given.
 *
 * This is the field that decides the video, and until now it was invisible:
 * scripting wrote it once, the site showed the narration and the image
 * prompt, and neither of those reaches it. So a producer who rewrote a scene
 * got a clip still performing the original direction — on a cinematic
 * project, where the narration is never spoken or captioned, editing the
 * script changed nothing about the output at all.
 *
 * Saving it un-approves the clip, because the clip on screen was made from
 * the direction being replaced.
 */
export async function saveVideoPrompt(
  projectId: string,
  sceneId: string,
  videoPrompt: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await writeSceneFields(sceneId, {
      "Video Scenă URL": videoPrompt,
      "Aprobare Video": false,
    });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Shot direction saved — the clip is back for review. Press Regenerate video to shoot it again.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function regenerateSceneText(
  projectId: string,
  sceneId: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    // Flag first — it drives the "Rewriting…" badge, and n8n clears it.
    await requestSceneRewrite(sceneId);
    await fireSceneRewriteWebhook(sceneId);

    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Rewrite requested — a fresh take on this scene appears here in ~30s (the page refreshes itself).",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Re-fire a per-scene rewrite that never came back.
 *
 * The scene-level twin of restartScripting. Both exist for the same reason:
 * the flag that means "in flight" is cleared from INSIDE the n8n run, so a
 * run that dies before clearing it leaves a state the UI can enter and never
 * leave. Re-posting is safe — the rewrite reads the scene fresh and writes
 * the whole result at the end, so a duplicate run costs one model call and
 * the last writer wins.
 */
export async function restartSceneRewrite(
  projectId: string,
  sceneId: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    // Re-arm rather than assume: the flag is what n8n's own loop matches on,
    // and a half-finished run may have moved the status elsewhere.
    await requestSceneRewrite(sceneId);
    await fireSceneRewriteWebhook(sceneId);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: "Rewrite sent again — a fresh take lands here in ~30s.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Give up on a stuck rewrite and hand the scene back to the reviewer with the
 * text it currently has. The escape hatch for when re-firing keeps failing —
 * without it, a scene whose rewrite service is down cannot be approved,
 * edited or even read, because the "Rewriting…" state hides every control.
 */
export async function cancelSceneRewrite(
  projectId: string,
  sceneId: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await releaseSceneRewrite(sceneId);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: "Rewrite cancelled — the scene is back in review with its current text.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Re-fire a video regeneration that nothing ever picked up.
 *
 * Video regen is the only regeneration with no webhook of its own — the flag
 * is noticed solely by `Evaluate Video Approval`, polling from inside a live
 * media-generation execution. So it strands in more ways than its siblings:
 * no batch alive, a batch already past the video gate, another project's run
 * making `getAliveProduction()` answer "alive", or the scene falling outside
 * `Sort & Cap Scenes`. Re-arming the flag and nudging production is the
 * cheapest thing that fixes all four.
 */
export async function restartVideoRegen(
  projectId: string,
  sceneId: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    // Same safety net as every other replacing path: keep the clip that is
    // about to be replaced, before anything can overwrite it.
    await autoKeep(sceneId, "video");
    await writeSceneApproval(sceneId, "video", "regenerate");
    const where = await nudgeProduction(projectId);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        where === "started"
          ? "Sent again — production was restarted and picks this clip up shortly."
          : where === "alive"
            ? "Sent again. Something is already running in n8n, so if this stays stuck it is that run rather than the flag — Pause, then Resume."
            : "Flag re-armed, but n8n could not be reached to start a batch. Use Resume once it answers.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Give up on a stuck video regeneration and keep the clip that exists.
 *
 * The escape hatch the image/voice/video regen states were missing: the badge
 * replaces the whole button row, so a stranded flag leaves the scene
 * unapprovable and unretryable. Approval is deliberately NOT restored — the
 * producer decides whether the old clip is good enough.
 */
export async function cancelVideoRegen(
  projectId: string,
  sceneId: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await writeSceneFields(sceneId, {
      "Regenerează Video": false,
      "Status Producție Scenă": "Așteaptă Aprobare Video",
    });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: "Cancelled — the scene keeps its current clip and is back in review.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Keep the asset that is on screen right now, before something replaces it.
 *
 * Every generation overwrites in place: one image and one clip per scene, and
 * the pipeline never keeps what it replaces. So a re-roll that came back
 * worse than the original was simply lost. This is the only place in the
 * system that copies an asset aside instead of over.
 *
 * An image is copied INTO Airtable (attachment), because fal's link expires
 * within hours and a saved draft that rots is worse than none. A clip already
 * lives on Drive behind a permanent link, so its URL is enough.
 */
export async function saveSceneVersion(
  projectId: string,
  sceneId: string,
  kind: "image" | "video",
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    const r = await saveVersionOfScene(sceneId, kind);
    if (!r.saved) return { ok: false, message: r.reason };
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: `Draft saved — you can bring this ${kind === "image" ? "image" : "clip"} back after a regeneration.`,
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Put a saved draft back as the live asset.
 *
 * Restoring an image also restores its Flow media id and the prompt that made
 * it — without the id the scene cannot generate video at all, and without the
 * prompt a later regeneration would re-roll from a description that no longer
 * matches the picture on screen.
 *
 * Approval is dropped rather than carried over: what is on screen changed, so
 * it deserves another look, and for an image the clip built from the previous
 * one is now stale too.
 */
export async function restoreSceneVersion(
  projectId: string,
  sceneId: string,
  versionId: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    const r = await restoreVersionOfScene(sceneId, versionId);
    if (!r.restored) return { ok: false, message: r.reason };
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        r.kind === "image"
          ? "Image restored, with the prompt and the Flow id it was made with. Approve it again when you're happy."
          : "Clip restored, with the shot direction it was made with. Approve it again when you're happy.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/** The steps a scene can be sent back to. The initial script is not one of
 *  them: it is written for the whole project, not per scene. */
export type ReopenStep = "scenes" | "images" | "audio" | "video";

/**
 * Reopen one completed step for ONE scene — the "Make changes" door.
 *
 * Approving a step used to be final: every control in it is gated on the
 * scene NOT being approved, so once signed off there was no way to touch it
 * again, however obviously wrong it turned out to be three steps later.
 *
 * Reopening is expressed as un-approval rather than as a separate "editing"
 * flag, and that is the whole trick: the existing per-scene controls
 * (rewrite the line, regenerate the image, re-record the voice, redo the
 * clip) reappear on their own, and n8n's gates — which ask whether EVERY
 * scene is approved — reopen with them. Nothing new has to be taught the
 * pipeline.
 *
 * Only the scene named here is touched, so the other scenes keep their
 * approvals and the batch has exactly one piece of outstanding work. What
 * cascades is what was actually derived from the changed thing:
 *   - the scene step owns BOTH the narration and the image prompt, so it
 *     invalidates everything after it → image + voice + video
 *   - the image is the clip's start frame   → video
 *   - the take is muxed into the cut        → video
 *   - the clip is the last derived asset    → nothing
 * Regeneration is deliberately NOT started here: reopening says "this needs
 * another look", and the producer then picks what to change.
 */
export async function reopenStep(
  projectId: string,
  sceneId: string,
  step: ReopenStep,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  // A silent film has no voice to redo, and no TTS runs that could ever
  // re-approve one. Un-approving it there builds a gate nothing can satisfy:
  // n8n waits for every voice to be approved, the site offers no take to
  // listen to, and the project stops for good. Seen on a cinematic project
  // whose only scene was sent back a step.
  const silent = getCategory((await getProject(projectId))?.category).noNarration === true;
  const cascade: Record<ReopenStep, Record<string, boolean>> = {
    scenes: {
      "Aprobare Scenă": false,
      "Aprobare Imagine": false,
      ...(silent ? {} : { "Aprobare Voce": false }),
      "Aprobare Video": false,
    },
    images: { "Aprobare Imagine": false, "Aprobare Video": false },
    audio: { "Aprobare Voce": false, "Aprobare Video": false },
    video: { "Aprobare Video": false },
  };
  if (silent && step === "audio") {
    return { ok: false, message: "This film has no narration — there is no voice step to reopen." };
  }
  const label: Record<ReopenStep, string> = {
    scenes: "the script",
    images: "the image",
    audio: "the voice",
    video: "the clip",
  };
  try {
    await writeSceneFields(sceneId, cascade[step]);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: `Reopened ${label[step]} for this scene — change it, then approve it again. Every other scene keeps its approval.`,
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/** Voice review gate — approving here lets video generation start. */
export async function approveVoices(
  projectId: string,
  sceneIds: string[],
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    for (const id of sceneIds) {
      await writeSceneFields(id, { "Aprobare Voce": true, "Regenerează Voce": false });
      // Airtable rate limit is 5 req/s per base; n8n polls concurrently.
      if (sceneIds.length > 1) await new Promise((r) => setTimeout(r, 250));
    }
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        sceneIds.length === 1
          ? "Voice approved."
          : `Approved ${sceneIds.length} voice lines — video generation starts once all are approved.`,
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Swap the narrator for the whole project and re-synthesize every line.
 * Writes the new voice on the project (so Resume and later regenerations use
 * it too), then flags every scene for voice regeneration.
 */
export async function changeProjectVoice(
  projectId: string,
  voiceId: string,
  sceneIds: string[],
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  if (!voiceId) return { ok: false, message: "Pick a voice first." };
  try {
    await writeProjectFields(projectId, { "Voice ID": voiceId });
    // The caller decides which lines actually need redoing — a line already
    // read by this voice keeps its take, and its approval.
    for (const id of sceneIds) {
      await writeSceneFields(id, { "Aprobare Voce": false });
      await regenerateVoice(projectId, id, "");
      await new Promise((r) => setTimeout(r, 250));
    }
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: sceneIds.length
        ? `Narrator changed — re-synthesizing ${sceneIds.length} line${sceneIds.length === 1 ? "" : "s"}.`
        : "Narrator changed — every line already used this voice, so nothing needed redoing.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Last stop before assembly: the overlay options chosen at creation time can
 * still be changed here, because the graphics pass reads them from the
 * project record at render time. Flipping the status to "Asamblare" is what
 * releases the batch, so both buttons end there — "keep" simply skips the
 * write.
 */
export async function confirmFinalSettings(
  projectId: string,
  settings?: {
    captions: boolean;
    hookTitle: boolean;
    chapterCards: boolean;
    endScreen: boolean;
    sfx: boolean;
    music: boolean;
    /* NO `speed` here, on purpose. The pace is decided and signed off at the
       audio step, which is the only moment it is free to change, and this
       panel must not be able to move it — nor to reset it. Because
       updateEditingOptions MERGES, omitting the key leaves the stored rate
       untouched; sending a defaulted one would have written `speed: 1` over
       the producer's choice on every render, which is the same shape as the
       Airtable bug where a mapped numeric field with no value wrote a
       literal 0. */
  },
  /**
   * The drawn cards the producer KEPT, when they dropped any.
   *
   * Passed with the render rather than saved on each click on purpose: this is
   * the last gate, the panel is a finishing screen, and a card removed here
   * should not become a separate write the producer has to remember to make.
   * Undefined means "leave them exactly as the pipeline chose them".
   */
  motifCards?: unknown[],
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    if (settings) {
      await writeProjectFields(projectId, {
        "Fără Subtitrări": !settings.captions,
      });
      // MERGED into the existing JSON, never overwritten — Editing Options
      // also carries category/multi-voice state that this panel doesn't own.
      await updateEditingOptions(projectId, {
        hookTitle: settings.hookTitle,
        chapterCards: settings.chapterCards,
        endScreen: settings.endScreen,
        sfx: settings.sfx,
        music: settings.music,
      });
    }
    // Same merge, separate condition: the cards change even when no toggle
    // did, and a producer who only dropped a card would otherwise press
    // render and watch it appear anyway.
    if (motifCards) {
      await updateEditingOptions(projectId, { motifCards });
    }
    await writeProjectFields(projectId, { "Status General": "Asamblare" });
    // Start the render OURSELVES via the assemble webhook — the proven path
    // every successful render has used. The n8n settings gate (a 15s Wait
    // loop in the batch that should notice the status change and release)
    // has never fired on its own on this instance: its in-memory timer dies,
    // production sits "Assembling" forever, and the producer ends up pressing
    // Restart render by hand on every single video. Firing here makes that
    // manual click the automatic behaviour.
    const fired = await fireAssembleWebhook(projectId);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: fired.ok
        ? settings
          ? "Settings saved — rendering started."
          : "Keeping the original settings — rendering started."
        : `Settings saved, but starting the render failed (${fired.message}) — press Restart render below.`,
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/** POST the Final Assembly webhook for a project. Shared by the
 *  final-settings confirm and the manual Restart render button. */
async function fireAssembleWebhook(projectId: string): Promise<ActionResult> {
  const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  const webhook =
    process.env.N8N_ASSEMBLE_WEBHOOK_URL ??
    newProject?.replace(/new-project\/?$/, "assemble");
  if (!webhook?.includes("assemble")) {
    return { ok: false, message: "The assembly webhook URL is not configured." };
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Project_ID: projectId }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`n8n webhook: HTTP ${res.status}`);
    return { ok: true, message: "started" };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/** Re-trigger the final render after it died, without redoing production. */
/**
 * Call off a render in progress and hand the project back to Final touches.
 *
 * The reason this exists is not that navigating away could interrupt the
 * render — it could not, the render lives in n8n and Railway. It is that
 * `confirmFinalSettings` fires the assemble webhook itself, so walking back
 * to Final touches and pressing render again starts a SECOND execution, and
 * both write `Link Video Final` on the same project. Stopping first is what
 * makes going back safe, so the two are one button.
 */
export async function stopAssembly(projectId: string): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    const alive = await getAliveAssembly().catch(() => []);
    for (const e of alive) await stopExecution(e.id).catch(() => {});
    // Back to the gate it came from: Final touches renders again, the render
    // lock lifts, and pressing render is a clean restart rather than a race.
    await writeProjectFields(projectId, { "Status General": "Setari Finale" });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: alive.length
        ? `Render stopped — back at Final touches. Nothing else was touched: every clip, take and approval is intact.`
        : "No render was running in n8n — the project is back at Final touches.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function retryAssembly(projectId: string): Promise<ActionResult> {
  const fired = await fireAssembleWebhook(projectId);
  if (!fired.ok) return fired;
  revalidatePath(`/projects/${projectId}`);
  return {
    ok: true,
    message: "Render restarted — it picks up the approved clips, nothing is regenerated.",
  };
}

/**
 * Change the film's sound after the fact: save the two audio switches into
 * Editing Options (merged), then re-render from the approved clips. This is
 * the only path to different sound on a FINISHED project — Final touches is
 * gone by then and plain Restart reuses whatever was stored.
 */
export async function rerenderWithSound(
  projectId: string,
  sfx: boolean,
  music: boolean,
  /** Playback rate of the finished film — see EditingOptions.speed. Carried
   *  here rather than in its own action because it changes the film the same
   *  way sound does: write the merged options, re-fire assemble, and the
   *  scenes are never regenerated. */
  speed: number = 1,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  const rate = normalizeSpeed(speed);
  try {
    await updateEditingOptions(projectId, { sfx, music, speed: rate });
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
  const fired = await fireAssembleWebhook(projectId);
  if (!fired.ok) return fired;
  revalidatePath(`/projects/${projectId}`);
  const pace =
    rate === 1 ? "normal speed" : `${rate}× speed`;
  return {
    ok: true,
    message: `Saved (effects ${sfx ? "on" : "off"}, music ${music ? "on" : "off"}, ${pace}) — re-rendering now. The new video replaces this one in a few minutes.`,
  };
}

/**
 * Characters mode: save which voice plays each character. n8n reads this
 * (castAssign in Editing Options) on every synthesis, so it applies to the
 * next regeneration of any line.
 */
/**
 * Chapter narrators (chapters mode). Saves the per-chapter voice map, then
 * re-synthesizes only the lines whose chapter actually changed — leaving
 * every other take, and its approval, untouched.
 */
export async function saveChapterVoices(
  projectId: string,
  voices: Record<string, string>,
  sceneIds: string[],
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await updateEditingOptions(projectId, { chapterVoices: voices });
    for (const id of sceneIds) {
      // Regenerating replaces the take, so the old approval can't stand.
      await writeSceneFields(id, { "Aprobare Voce": false });
      await regenerateVoice(projectId, id, "");
      await new Promise((r) => setTimeout(r, 250));
    }
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: sceneIds.length
        ? `Chapter narrators saved — re-synthesizing ${sceneIds.length} line${sceneIds.length === 1 ? "" : "s"}.`
        : "Chapter narrators saved.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Collapse a multi-voice project back to a single narrator: the mode goes to
 * "off" and the caller's lines are re-synthesized with the chosen voice —
 * normally only those not already read by it. The chapter map is deliberately
 * kept, so switching back restores the old assignment instead of losing it.
 */
export async function useSingleNarrator(
  projectId: string,
  voiceId: string,
  sceneIds: string[],
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  if (!voiceId) return { ok: false, message: "Pick a voice first." };
  try {
    await updateEditingOptions(projectId, { multiVoiceMode: "off" });
    return await changeProjectVoice(projectId, voiceId, sceneIds);
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/** The way back: re-enable narrator-per-chapter with the saved assignment. */
export async function useChapterNarrators(projectId: string): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await updateEditingOptions(projectId, { multiVoiceMode: "chapters" });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Narrator-per-chapter is back on — pick the voices, then apply to re-synthesize.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function saveCastAssignments(
  projectId: string,
  assign: Record<string, string>,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await updateEditingOptions(projectId, { castAssign: assign });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Cast saved — it applies to every line you regenerate from now on.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Set the film's playback speed from the AUDIO step, before any picture
 * exists.
 *
 * It writes the same `Editing Options.speed` that Final touches and the
 * post-render sound panel write — one stored value behind three doors, so a
 * pace chosen here is the one those two show later rather than a fourth
 * setting to reconcile.
 *
 * What it deliberately does NOT do is fire a render, which is the whole
 * difference from `rerenderWithSound`: at the audio step there is no film to
 * re-cut, so the value simply waits for assembly, where speed.mjs applies it.
 * That is also why this is the cheapest possible moment to make the decision —
 * the alternative is discovering the film is too slow after paying for every
 * clip.
 */
export async function savePlaybackSpeed(
  projectId: string,
  speed: number,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  const rate = normalizeSpeed(speed);
  try {
    // Locked in the same write as the rate it locks. Two writes could leave
    // a project signed off at a pace it never stored, or storing a pace
    // nobody signed off — and only one of those two is visible on screen.
    await updateEditingOptions(projectId, { speed: rate, speedLocked: true });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        rate === 1
          ? "Pace saved — normal, the film plays as recorded."
          : `Pace saved — ${rate}×, applied to the whole film at assembly, picture and narration together.`,
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Set how the narrator READS, from the audio step or the brief's stored value.
 *
 * `null` is a real choice and is stored as one: jsonb keeps an explicit null,
 * which `normalizeVoiceTone` reads back as "send nothing", so "back to the
 * voice's own settings" survives the merge. Writing `{}` instead would leave
 * the previous tone in place, because `updateEditingOptions` MERGES — the same
 * trap that made `confirmFinalSettings` overwrite the producer's pace.
 *
 * Unlike the pace, this changes NOTHING that already exists. Takes are
 * synthesized once and never re-synthesized on their own (the batch refuses to
 * overwrite a voiceover that is there), so a tone saved here reaches only the
 * lines recorded after it. `rerecordVoices` is the other half.
 */
export async function saveVoiceSettings(
  projectId: string,
  tone: VoiceTone | null,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  const clean = normalizeVoiceTone(tone);
  try {
    await updateEditingOptions(projectId, { voice: clean });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: clean
        ? "Voice character saved. Lines recorded from now on use it — re-record the ones you already have to hear it."
        : "Back to each voice's own settings. Lines recorded from now on use them.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Re-record a set of takes, so a new voice character can actually be heard.
 *
 * This exists because the tone cannot be auditioned any other way. The pace
 * preview retimes audio that is already on the page; a generation setting only
 * shows up in a fresh synthesis, so without this the control would be a
 * promise the producer has to take on trust.
 *
 * Fired one at a time and awaited, NOT in parallel. Each call starts its own
 * n8n execution and ElevenLabs allows five concurrent requests on this
 * account — a fan-out of fifteen would have some of them fail, and a failed
 * re-record leaves the scene holding its regen flag with the take unchanged,
 * which the UI shows as a synthesis that never finishes.
 */
export async function rerecordVoices(
  projectId: string,
  scenes: { id: string; narration: string }[],
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  let queued = 0;
  const failed: string[] = [];
  for (const s of scenes) {
    const r = await regenerateVoice(projectId, s.id, s.narration);
    if (r.ok) queued++;
    else failed.push(r.message);
  }
  revalidatePath(`/projects/${projectId}`);
  if (queued === 0) {
    return { ok: false, message: failed[0] ?? "Nothing was re-recorded." };
  }
  // Partial success is reported as success with the count, because the takes
  // that DID queue are really being made and saying "failed" would send the
  // producer looking for a problem with all of them.
  return {
    ok: true,
    message:
      failed.length === 0
        ? `Re-recording ${queued} take${queued === 1 ? "" : "s"} — they arrive over the next minute or two (the page refreshes itself).`
        : `Re-recording ${queued} of ${scenes.length} takes. ${failed.length} could not be queued: ${failed[0]}`,
  };
}

/**
 * Reopen the pace after it was signed off.
 *
 * Deliberately clears the lock ONLY, leaving the stored rate alone: reopening
 * means "I want to look at this again", not "throw away what I chose", so the
 * picker comes back sitting on the pace the film currently has.
 */
export async function reopenPlaybackSpeed(
  projectId: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await updateEditingOptions(projectId, { speedLocked: false });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: "Pace reopened — pick a new one and save it again.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function approveAllScenes(
  projectId: string,
  sceneIds: string[],
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    for (const id of sceneIds) {
      await writeSceneScript(id, { approve: true });
      // Airtable rate limit is 5 req/s per base.
      await new Promise((r) => setTimeout(r, 250));
    }
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: `Approved ${sceneIds.length} scenes — production continues.` };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function saveScript(
  projectId: string,
  scriptId: string,
  content: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await writeScriptFields(scriptId, { "Script Content": content });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: "Draft saved. Approve when you're happy with it." };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function approveScript(
  projectId: string,
  scriptId: string,
  content?: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    // The scripting workflow polls the Scripturi record: it resumes when
    // Status flips to "approved" and reads the (possibly edited) Script
    // Content, so saving and approving in one write is safe.
    const fields: Record<string, unknown> = { Status: "approved" };
    if (typeof content === "string" && content.trim()) {
      fields["Script Content"] = content;
    }
    await writeScriptFields(scriptId, fields);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: "Script approved — production continues." };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function regenerateScript(
  projectId: string,
  scriptId: string,
  feedback: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    // The scripting workflow polls this record: Status 'rejected' routes it
    // to an AI rewrite using the feedback, then flips back to
    // awaiting_approval with the new draft.
    await writeScriptFields(scriptId, {
      Status: "rejected",
      "Observații Script": feedback.trim() || "Improve pacing, concreteness and flow.",
    });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Rewrite requested — a new draft appears here in ~1 minute (the page refreshes itself).",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function createProject(formData: FormData): Promise<ActionResult> {
  const webhook = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  if (!webhook) {
    return {
      ok: false,
      message:
        "N8N_NEW_PROJECT_WEBHOOK_URL is not set. Add the n8n form/webhook URL to the environment to start projects from here.",
    };
  }
  // Category + its options (cat_* fields, defined in lib/categories.ts).
  // They ride along inside the webhook payload; n8n stores them in the
  // project's Editing Options JSON, so no Airtable schema change is needed.
  const categoryOptions: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("cat_")) categoryOptions[k.slice(4)] = String(v);
  }
  // The cast is a comma-separated list of voice ids (multi-voice stories).
  const cast = String(formData.get("cast_voices") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  // Optional reference photo for the first scene. Base64 rides the webhook
  // JSON; the orchestrator uploads it to Drive and stores the URL in
  // Editing Options as refImage, which Media Generation uses as the fal
  // edit reference for the scene with Ordine 1.
  let reference_image: { name: string; type: string; data: string } | null = null;
  const refFile = formData.get("reference_image");
  if (refFile instanceof File && refFile.size > 0) {
    if (refFile.size > 6 * 1024 * 1024) {
      return {
        ok: false,
        message: "The reference image is too large — keep it under 6 MB.",
      };
    }
    if (!/^image\/(jpeg|png|webp)$/.test(refFile.type)) {
      return {
        ok: false,
        message: "The reference image must be a JPG, PNG or WebP.",
      };
    }
    reference_image = {
      name: refFile.name,
      type: refFile.type,
      data: Buffer.from(await refFile.arrayBuffer()).toString("base64"),
    };
  }
  // Posted as JSON by the brief's one voice-character control, or "" for the
  // voice's own settings. Parsed defensively: a malformed value has to read as
  // "leave the voice alone" rather than block the whole submission, because
  // this field is the one thing on the form that a producer can safely ignore.
  let voiceTone: VoiceTone | null = null;
  try {
    voiceTone = normalizeVoiceTone(JSON.parse(String(formData.get("voice_tone") || "null")));
  } catch {
    voiceTone = null;
  }

  const payload = {
    "Nume Proiect": String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? "story"),
    category_options: categoryOptions,
    cast_voices: cast,
    Language: String(formData.get("language") ?? "English"),
    Lenght: Number(formData.get("length") ?? 64),
    Tonalitate: String(formData.get("tone") ?? "Dark"),
    Pace: String(formData.get("pace") ?? "Normal"),
    // The exact playback rate the brief's PACE control chose. `Pace` above is
    // still the word, because Claude Scripting interpolates it into two
    // writing prompts — but the word cannot tell 0.8 from 0.9, so the number
    // rides alongside it and `Normalize Webhook Input` puts it in Editing
    // Options. Absent or unusable resolves to 1 on every reader.
    speed: normalizeSpeed(formData.get("speed")),
    Style: String(formData.get("style") ?? ""),
    // In chapters mode (and no-narrator characters mode) there is no
    // narrator picker; the first cast voice doubles as the project voice so
    // n8n's fallbacks (hook, legacy paths) stay sensible.
    voice_id: String(formData.get("voice_id") ?? "") || cast[0] || "",
    aspect: String(formData.get("aspect") ?? "16:9"),
    captions: String(formData.get("captions") ?? "yes"),
    lore: String(formData.get("lore") ?? ""),
    hook_title: String(formData.get("hook_title") ?? "yes"),
    chapter_cards: String(formData.get("chapter_cards") ?? "yes"),
    end_screen: String(formData.get("end_screen") ?? "yes"),
    sfx: String(formData.get("sfx") ?? "yes"),
    // How loud that ambience sits, 0–1. Travels as a number rather than the
    // slider's percentage so the pipeline carries one unit end to end: it is
    // `nativeAudio` in the assemble request, and the mixer takes a gain.
    sfx_level: normalizeSfxLevel(formData.get("sfx_level")),
    music: String(formData.get("music") ?? "no"),
    // How the narrator reads. OMITTED when the producer left it on "Voice
    // default", and that absence is the feature: every ElevenLabs voice has
    // its own stored settings, so sending an object we made up would override
    // that voice's own tuning on every line of the film. `Normalize Webhook
    // Input` copies it into Editing Options only when it is here.
    ...(voiceTone ? { voice_tone: voiceTone } : {}),
    ...(reference_image ? { reference_image } : {}),
  };
  // A no-narration category has nothing to speak and nothing to caption —
  // enforce that server-side no matter what the form controls held.
  if (payload.category === "cinematic") {
    payload.voice_id = "";
    payload.cast_voices = [];
    payload.captions = "no";
    // Nothing is spoken, so a voice character is a setting with no subject.
    // Deleting rather than blanking, because the key's ABSENCE is what tells
    // n8n not to write it at all.
    delete (payload as { voice_tone?: VoiceTone }).voice_tone;
  }
  const projectName = payload["Nume Proiect"];
  let newProjectId: string | null = null;
  let webhookError: string | null = null;
  // What n8n actually replied. Surfaced in the failure message so a broken
  // webhook can be diagnosed from the UI alone, without n8n access.
  let webhookReply: string | null = null;

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Never leave the form stuck on "Starting…" — but a timeout is NOT
      // success. It just means we have to go ask Airtable ourselves.
      signal: AbortSignal.timeout(20000),
    });
    const body = (await res.text()).trim();
    webhookReply = `HTTP ${res.status}${body ? ` — ${body.slice(0, 180)}` : " — empty body"}`;
    if (!res.ok) throw new Error(`n8n webhook: ${webhookReply}`);
    try {
      const data = JSON.parse(body) as { project_id?: string };
      if (data?.project_id?.startsWith("rec")) newProjectId = data.project_id;
    } catch {
      // Not JSON — e.g. n8n's immediate "Workflow got started." reply, which
      // means the webhook is answering before the record is created.
    }
  } catch (e) {
    webhookError =
      e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
        ? "n8n did not answer within 20s"
        : friendlyError(e);
  }

  // The webhook's word is not evidence. Confirm against Airtable — n8n can
  // answer 200 and still fail at a later node, and it can time out after
  // having created the record. Only a real record counts as success.
  if (!newProjectId && isConfigured) {
    for (let attempt = 0; attempt < 6 && !newProjectId; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 0 : 2000));
      try {
        newProjectId = await findRecentProjectByName(projectName);
      } catch {
        // Airtable unreachable — fall through to the honest failure below.
      }
    }
  }

  revalidatePath("/");
  if (newProjectId) redirect(`/projects/${newProjectId}`); // throws — keep outside try
  return {
    ok: false,
    message:
      `The project was NOT created — no record exists in Airtable. Nothing is running. ` +
      `n8n replied: ${webhookError ?? webhookReply ?? "no reply captured"}`,
  };
}

export async function deleteProjects(projectIds: string[]): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was deleted." };
  }
  // Stop any running production first, children before orchestrator —
  // otherwise a live execution would error (or recreate records) when it
  // next writes to the rows we're about to delete. The API can't map an
  // execution to a project, so this pauses everything; Resume on another
  // project picks up exactly where it left off.
  let stoppedRuns = 0;
  try {
    const running = await getExecutions("running", 20);
    const order = ["Media Generation", "Final Assembly", "Scripting", "Master Orchestrator"];
    const sorted = [...running].sort(
      (a, b) => order.indexOf(a.workflowName) - order.indexOf(b.workflowName),
    );
    for (const r of sorted) {
      const res = await stopExecution(r.id);
      if (res.ok) stoppedRuns++;
    }
  } catch {
    // n8n API unreachable — proceed with the delete; worst case a running
    // execution errors against the missing records, which is harmless.
  }
  let deleted = 0;
  try {
    for (const id of projectIds) {
      await deleteProjectDeep(id);
      deleted++;
    }
    revalidatePath("/");
    return {
      ok: true,
      message:
        `Deleted ${deleted} project${deleted === 1 ? "" : "s"} (scenes and scripts included).` +
        (stoppedRuns > 0 ? ` Stopped ${stoppedRuns} running workflow${stoppedRuns === 1 ? "" : "s"} first.` : ""),
    };
  } catch (e) {
    revalidatePath("/");
    return {
      ok: false,
      message: `Deleted ${deleted}/${projectIds.length}, then failed: ${friendlyError(e)}`,
    };
  }
}

/**
 * Restart the WRITING of a project — the script, and the split of each
 * chapter into scenes.
 *
 * resumeProject cannot do this: the orchestrator's resume path enters at
 * media generation, because it was built for a project whose scenes already
 * exist. A run that dies while the script is still being written therefore
 * had no way back at all — Pause could stop it, and then nothing could start
 * it again. This is the missing half.
 *
 * Scripting rewrites the project's script and scenes, so it is only offered
 * before any scene has been approved; past that point the production resume
 * is the right door and this one would throw away reviewed work.
 */
export async function restartScripting(projectId: string): Promise<ActionResult> {
  const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  const webhook =
    process.env.N8N_RESTART_SCRIPTING_WEBHOOK_URL ??
    newProject?.replace(/new-project\/?$/, "restart-scripting");
  if (!webhook || !webhook.includes("restart-scripting")) {
    return { ok: false, message: "N8N_NEW_PROJECT_WEBHOOK_URL is not configured." };
  }
  try {
    const alive = await getAliveProduction().catch(() => []);
    if (alive.length > 0) {
      return {
        ok: false,
        message:
          "Something is still running in n8n — pause it first, then restart the script.",
      };
    }
    for (const dead of await getStalledProduction().catch(() => [])) {
      await stopExecution(dead.id).catch(() => {});
    }
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) {
      return {
        ok: false,
        message:
          "n8n has no „restart-scripting” webhook yet — add it to the Master Orchestrator (fetch the project, then Execute Scripting), and this button starts working.",
      };
    }
    if (!res.ok) throw new Error(`n8n webhook: HTTP ${res.status}`);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Writing restarted — the script and its scenes are being produced again. This page refreshes itself.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function resumeProject(projectId: string): Promise<ActionResult> {
  const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  const webhook =
    process.env.N8N_RESUME_WEBHOOK_URL ??
    // Same n8n instance, sibling path — avoids one more env var.
    newProject?.replace(/new-project\/?$/, "resume-project");
  if (!webhook || !webhook.includes("resume-project")) {
    return { ok: false, message: "N8N_RESUME_WEBHOOK_URL is not configured." };
  }
  try {
    // A live execution means resuming would start a duplicate batch —
    // zombie-filtered, so ancient stuck "waiting" parents don't block us.
    const alive = await getAliveProduction().catch(() => []);
    if (alive.length > 0) {
      return {
        ok: false,
        message:
          "Production is already running (an execution is active in n8n) — nothing was restarted. The page refreshes itself; if it looks stuck for more than a few minutes, use Pause first, then Resume.",
      };
    }
    // Clear out executions n8n created but never ran. They report as running
    // forever, so left alone they pile up and each one keeps its parent
    // orchestrator wedged in waitForSubWorkflow.
    for (const dead of await getStalledProduction().catch(() => [])) {
      await stopExecution(dead.id).catch(() => {});
    }
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!res.ok) throw new Error(`n8n webhook: HTTP ${res.status}`);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Production resumed — already-generated images, voices and clips are kept; only missing pieces are regenerated.",
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function pauseProduction(projectId: string): Promise<ActionResult> {
  try {
    // Stop children before the orchestrator so nothing re-spawns work.
    // Nothing is lost: every finished asset is already in Airtable/Drive,
    // and Resume picks up exactly where this left off.
    const running = await getExecutions("running", 20);
    if (running.length === 0) {
      return { ok: false, message: "Nothing is running right now." };
    }
    const order = ["Media Generation", "Final Assembly", "Scripting", "Master Orchestrator"];
    const sorted = [...running].sort(
      (a, b) => order.indexOf(a.workflowName) - order.indexOf(b.workflowName),
    );
    let stopped = 0;
    for (const r of sorted) {
      const res = await stopExecution(r.id);
      if (res.ok) stopped++;
    }
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/");
    return {
      ok: true,
      message: `Paused — stopped ${stopped} running execution${stopped === 1 ? "" : "s"}. Press Resume to continue from where it left off.`,
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/**
 * Pause + Resume in one press, for production that claims to be running and
 * plainly is not.
 *
 * n8n sometimes creates an execution and never runs a single node of it —
 * `runData` stays `{}`, the node stack never leaves the trigger, and the row
 * reports `running` forever. Execution 2704 is the specimen: created at
 * 12:43:56 as a child of a resume webhook, still "running" twenty minutes
 * later with nothing executed, while the instance itself was perfectly
 * healthy (a 5-minute cron kept succeeding right through it).
 *
 * There is no API signal that separates that from a healthy batch — n8n does
 * not persist progress mid-run, so a live render and a dead one read
 * identically, and inventing a progress test is exactly the mistake that once
 * had the site killing its own healthy renders. What is safe is a MANUAL door:
 * `resumeProject` refuses while anything is alive (rightly — it would start a
 * duplicate batch), so the escape has to stop the wedged execution first, and
 * the producer is the one who decides that it is wedged.
 *
 * Nothing is lost by pressing it: every finished image, take and clip is
 * already in Airtable, and the batch skips whatever exists.
 */
export async function restartProduction(projectId: string): Promise<ActionResult> {
  const paused = await pauseProduction(projectId);
  // n8n marks a stopped execution canceled asynchronously, and resumeProject
  // refuses while anything still reads alive — so wait for the list to clear
  // rather than handing back a "already running" that the producer would have
  // to press through a second time.
  for (let i = 0; i < 6; i++) {
    const still = await getAliveProduction().catch(() => []);
    if (still.length === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // "Nothing is running" is not a failure here — it means the execution died
  // between the render and the click, and resuming is still the right move.
  const resumed = await resumeProject(projectId);
  if (!resumed.ok) return resumed;
  return {
    ok: true,
    message: paused.ok
      ? `${paused.message} ${resumed.message}`
      : resumed.message,
  };
}

export async function stopExecutionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("executionId") ?? "");
  if (id) await stopExecution(id);
  revalidatePath("/");
}

// ---------- auth (simple shared password until Supabase lands) ----------
export async function login(formData: FormData): Promise<ActionResult> {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) redirect("/");
  if (String(formData.get("password")) !== expected) {
    return { ok: false, message: "Wrong password." };
  }
  const jar = await cookies();
  jar.set("vf_auth", expected, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  redirect("/");
}
