"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isConfigured, writeProjectFields, writeSceneApproval } from "@/lib/data";
import { stopExecution } from "@/lib/n8n";

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
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written. Connect Airtable to make this real." };
  }
  try {
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

export async function approveAllImages(
  projectId: string,
  sceneIds: string[],
): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    for (const id of sceneIds) {
      await writeSceneApproval(id, "image", "approve");
      // Airtable rate limit is 5 req/s per base; n8n polls concurrently.
      await new Promise((r) => setTimeout(r, 250));
    }
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: `Approved ${sceneIds.length} images.` };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export async function approveScript(projectId: string): Promise<ActionResult> {
  if (!isConfigured) {
    return { ok: true, message: "Demo mode — nothing was written." };
  }
  try {
    // The orchestrator's "Check Script Status" gate reads the boolean
    // "Script Status" field on the project record — the same checkbox
    // approved manually in Airtable until now.
    await writeProjectFields(projectId, { "Script Status": true });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: "Script approved — production continues." };
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
  };
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`n8n webhook: HTTP ${res.status}`);
    revalidatePath("/");
    return { ok: true, message: "Production started — the project appears on the dashboard shortly." };
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
