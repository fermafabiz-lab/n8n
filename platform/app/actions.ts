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
  requestSceneRewrite,
  findRecentProjectByName,
  writeScriptFields,
  requestVoiceRegen,
  deleteProjectDeep,
} from "@/lib/data";
import { getExecutions, stopExecution } from "@/lib/n8n";

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
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await requestVoiceRegen(sceneId, narration);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Voice regeneration queued — a new voiceover is synthesized and re-muxed onto the existing clip (~1-2 min).",
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
    await writeSceneScript(sceneId, { narration, imagePrompt, approve });
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: approve
        ? "Scene approved — production continues once every scene is approved."
        : "Scene saved.",
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

export async function regenerateSceneText(
  projectId: string,
  sceneId: string,
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    await requestSceneRewrite(sceneId);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message:
        "Rewrite requested — a fresh take on this scene appears here in ~1 minute (the page refreshes itself).",
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
  const payload = {
    "Nume Proiect": String(formData.get("name") ?? ""),
    Language: String(formData.get("language") ?? "English"),
    Lenght: Number(formData.get("length") ?? 64),
    Tonalitate: String(formData.get("tone") ?? "Dark"),
    Pace: String(formData.get("pace") ?? "Normal"),
    Style: String(formData.get("style") ?? ""),
    voice_id: String(formData.get("voice_id") ?? ""),
    aspect: String(formData.get("aspect") ?? "16:9"),
    captions: String(formData.get("captions") ?? "yes"),
    lore: String(formData.get("lore") ?? ""),
    hook_title: String(formData.get("hook_title") ?? "yes"),
    chapter_cards: String(formData.get("chapter_cards") ?? "yes"),
    end_screen: String(formData.get("end_screen") ?? "yes"),
  };
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
