"use server";

/**
 * What a person may do to the footage library from the admin page.
 *
 * Every write here is a HUMAN decision — verify, reject, retag, change the
 * provenance, delete — and is recorded as one: `updateStockMedia` stamps
 * `verified_at`, after which a re-sighting of the same asset keeps the
 * person's provenance instead of the classifier's. The one thing nobody may
 * do from here is call an upload ACTUAL FOOTAGE without saying what event,
 * where and when — the same rule the scene's Footage type control lives
 * under.
 */

import { revalidatePath } from "next/cache";
import { deleteStockMedia, getStockMedia, setStockStatus, updateStockMedia, type StockPatch } from "@/lib/data/stock";
import { useArchiveAsset, type ActionResult } from "@/app/actions";
import { normalizeVisualOrigin } from "@/lib/provenance";
import type { FootageProvenance } from "@/lib/archive/types";

const usable = () => process.env.DATA_BACKEND === "postgres";
const REC = /^rec[0-9A-Za-z]{14}$/;
const text = (v: FormDataEntryValue | null, cap = 400): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, cap) : null;
};
const list = (v: FormDataEntryValue | null): string[] =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);

function done(message: string): ActionResult {
  revalidatePath("/admin/footage");
  return { ok: true, message };
}

/** Verify: a person looked and approves it for rendering. Rights review passes here. */
export async function verifyFootage(id: string, note?: string): Promise<ActionResult> {
  if (!usable()) return { ok: false, message: "The library needs the Postgres backend." };
  if (!REC.test(id)) return { ok: false, message: "Bad id." };
  try {
    const row = await getStockMedia(id);
    if (!row) return { ok: false, message: "Not in the library." };
    if (row.reviewStatus === "rejected") return { ok: false, message: "Its licence forbids this use — verifying cannot change what a licence says." };
    await updateStockMedia(id, {}, note ?? "Verified on the admin page.");
    await setStockStatus(id, "approved");
    return done("Verified — usable for rendering.");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function rejectFootage(id: string): Promise<ActionResult> {
  if (!usable()) return { ok: false, message: "The library needs the Postgres backend." };
  if (!REC.test(id)) return { ok: false, message: "Bad id." };
  try {
    await setStockStatus(id, "rejected");
    return done("Rejected — it will not be offered again.");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function deleteFootage(id: string): Promise<ActionResult> {
  if (!usable()) return { ok: false, message: "The library needs the Postgres backend." };
  if (!REC.test(id)) return { ok: false, message: "Bad id." };
  try {
    const ok = await deleteStockMedia(id);
    return ok ? done("Removed from the local index.") : { ok: false, message: "Not in the library." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Edit metadata, retag, or change the provenance — one form, one write. */
export async function updateFootage(id: string, form: FormData): Promise<ActionResult> {
  if (!usable()) return { ok: false, message: "The library needs the Postgres backend." };
  if (!REC.test(id)) return { ok: false, message: "Bad id." };
  const patch: StockPatch = {};
  const title = text(form.get("title"), 200);
  if (title) patch.title = title;
  if (form.has("description")) patch.description = text(form.get("description"), 2000);
  if (form.has("eventName")) patch.eventName = text(form.get("eventName"), 200);
  if (form.has("location")) patch.location = text(form.get("location"), 200);
  if (form.has("country")) patch.country = text(form.get("country"), 80);
  if (form.has("filmingDate")) patch.filmingDate = text(form.get("filmingDate"), 40);
  if (form.has("categories")) patch.categories = list(form.get("categories"));
  if (form.has("people")) patch.people = list(form.get("people"));
  if (form.has("organizations")) patch.organizations = list(form.get("organizations"));
  if (form.has("credit")) patch.credit = text(form.get("credit"), 300);
  if (form.has("notes")) patch.notes = text(form.get("notes"), 1000);

  const prov = text(form.get("provenance"), 40);
  if (prov) {
    const p = normalizeVisualOrigin(prov);
    if (!p || p === "ai_generated" || p === "ai_reconstruction") return { ok: false, message: "That is not a footage provenance." };
    // Actual footage is a claim about the world: it needs the event, the
    // place and the date named, or it is a label with nothing behind it.
    if (p === "actual_footage" && !(patch.eventName && patch.location && patch.filmingDate)) {
      return { ok: false, message: "ACTUAL FOOTAGE needs the event, the place and the date filled in — it is a claim about the world." };
    }
    patch.provenance = p as FootageProvenance;
    patch.provenanceConfidence = p === "unknown" ? 0 : 100;
  }

  const rights = text(form.get("rights"), 40);
  if (rights) {
    const row = await getStockMedia(id);
    if (row?.reviewStatus === "rejected" && rights !== "restricted") {
      return { ok: false, message: "Its licence forbids this use — a rights class cannot be raised over what the licence says." };
    }
    if (rights === "cleared" || rights === "attribution_required") {
      patch.reviewStatus = "auto_approved";
      patch.reviewReason = null;
      patch.attributionRequired = rights === "attribution_required";
    } else if (rights === "manual_review") {
      patch.reviewStatus = "manual_review";
      patch.reviewReason = "Set to manual review on the admin page.";
    } else if (rights === "restricted") {
      patch.reviewStatus = "rejected";
      patch.reviewReason = "Marked restricted on the admin page.";
    }
  }

  try {
    const saved = await updateStockMedia(id, patch, "Edited on the admin page.");
    if (!saved) return { ok: false, message: "Not in the library." };
    if (patch.reviewStatus === "rejected") await setStockStatus(id, "rejected");
    return done("Saved.");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Put a library asset on a scene from the admin page. Same path as the picker's "Use". */
export async function useFootageInScene(id: string, projectId: string, sceneId: string): Promise<ActionResult> {
  if (!REC.test(id) || !REC.test(projectId) || !REC.test(sceneId)) return { ok: false, message: "Bad id." };
  return useArchiveAsset(projectId, sceneId, id, {});
}
