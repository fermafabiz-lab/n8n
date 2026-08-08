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
  findRecentProjectByName,
  writeScriptFields,
  requestVoiceRegen,
  deleteProjectDeep,
  updateEditingOptions,
} from "@/lib/data";
import {
  getAliveProduction,
  getExecutions,
  getStalledProduction,
  stopExecution,
} from "@/lib/n8n";

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
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        action === "approve"
          ? `${kind === "image" ? "Image" : "Video"} approved.`
          : `Regeneration queued — n8n picks it up within ~15s.`,
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
    for (const id of sceneIds) {
      await writeSceneApproval(id, kind, "approve");
      // Airtable rate limit is 5 req/s per base; n8n polls concurrently.
      await new Promise((r) => setTimeout(r, 250));
    }
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: `Approved ${sceneIds.length} ${kind === "image" ? "images" : "videos"}.`,
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

    await writeSceneScript(sceneId, { narration, imagePrompt, approve });

    if (staleVoice) {
      // Same door the audio panel uses — saves the line and re-reads it.
      await regenerateVoice(projectId, sceneId, narration);
    }

    revalidatePath(`/projects/${projectId}`);
    const suffix = staleVoice
      ? " The line changed after it had been recorded, so the voice is being read again."
      : "";
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
 *   - the line drives the take and the cut  → voice + video
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
  const cascade: Record<ReopenStep, Record<string, boolean>> = {
    scenes: { "Aprobare Scenă": false, "Aprobare Voce": false, "Aprobare Video": false },
    images: { "Aprobare Imagine": false, "Aprobare Video": false },
    audio: { "Aprobare Voce": false, "Aprobare Video": false },
    video: { "Aprobare Video": false },
  };
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
  },
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
  const payload = {
    "Nume Proiect": String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? "story"),
    category_options: categoryOptions,
    cast_voices: cast,
    Language: String(formData.get("language") ?? "English"),
    Lenght: Number(formData.get("length") ?? 64),
    Tonalitate: String(formData.get("tone") ?? "Dark"),
    Pace: String(formData.get("pace") ?? "Normal"),
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
    music: String(formData.get("music") ?? "no"),
  };
  // A no-narration category has nothing to speak and nothing to caption —
  // enforce that server-side no matter what the form controls held.
  if (payload.category === "cinematic") {
    payload.voice_id = "";
    payload.cast_voices = [];
    payload.captions = "no";
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
