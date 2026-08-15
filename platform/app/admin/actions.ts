"use server";

import { revalidatePath } from "next/cache";
import {
  createGenreProfile,
  EXAMPLE_EDITABLE,
  GENRE_EDITABLE,
  LIBRARY_EDITABLE,
  saveGenreProfile,
  saveLibraryScript,
  saveScriptExample,
} from "@/lib/data";
import { isConfigured } from "@/lib/data";

export type AdminResult = { ok: boolean; message: string };

/**
 * Read a form into a patch, coercing by the field's declared kind.
 *
 * Only keys on the table's allow-list are considered. A form field that
 * silently does nothing is the exact failure these screens exist to end, so an
 * unknown key is dropped here and would fail loudly in the data layer if it
 * ever reached it.
 */
function patchFrom(
  form: FormData,
  allowed: readonly string[],
  kinds: Record<string, "text" | "number" | "bool" | "list">,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    const kind = kinds[key] ?? "text";
    if (kind === "bool") {
      // An unchecked box sends nothing at all, which is the value.
      patch[key] = form.get(key) === "on" || form.get(key) === "true";
      continue;
    }
    const raw = form.get(key);
    if (raw === null) continue;
    const s = String(raw);
    if (kind === "number") {
      const n = Number(s);
      patch[key] = s.trim() === "" || !Number.isFinite(n) ? null : n;
    } else if (kind === "list") {
      patch[key] = s.split(",").map((v) => v.trim()).filter(Boolean);
    } else {
      patch[key] = s.trim() === "" ? null : s;
    }
  }
  return patch;
}

const GENRE_KINDS = {
  research: "bool", active: "bool", wpm: "number", montageIntensity: "number",
} as const;

const LIBRARY_KINDS = {
  active: "bool", pacingWpm: "number", hookWpm: "number", durationSeconds: "number",
} as const;

const EXAMPLE_KINDS = { style: "list", tags: "list" } as const;

function guard(): AdminResult | null {
  if (!isConfigured) return { ok: true, message: "Demo mode — nothing was written." };
  return null;
}

function fail(e: unknown): AdminResult {
  return { ok: false, message: (e as Error).message || "Something went wrong." };
}

export async function updateGenre(id: string, form: FormData): Promise<AdminResult> {
  const demo = guard();
  if (demo) return demo;
  try {
    const patch = patchFrom(form, GENRE_EDITABLE, GENRE_KINDS);
    // The tone IS the lookup key — Claude Scripting finds the row by matching
    // it against the form's option. Blanking it makes the profile unreachable
    // rather than merely unnamed.
    if (!String(patch.tone ?? "").trim()) {
      return { ok: false, message: "Tone cannot be empty — it is how scripting finds this row." };
    }
    await saveGenreProfile(id, patch);
    revalidatePath("/admin");
    return { ok: true, message: "Saved. The next film picks it up." };
  } catch (e) {
    return fail(e);
  }
}

export async function addGenre(form: FormData): Promise<AdminResult> {
  const demo = guard();
  if (demo) return demo;
  const tone = String(form.get("tone") ?? "").trim();
  if (!tone) return { ok: false, message: "Give it a tone first." };
  try {
    await createGenreProfile(tone);
    revalidatePath("/admin");
    // Inactive on purpose: a half-filled profile that scripting starts using
    // immediately is worse than no profile, because the built-in fallback is
    // complete and this one is not.
    return { ok: true, message: `"${tone}" created, inactive. Fill it in, then switch it on.` };
  } catch (e) {
    return fail(e);
  }
}

export async function updateLibrary(id: string, form: FormData): Promise<AdminResult> {
  const demo = guard();
  if (demo) return demo;
  try {
    await saveLibraryScript(id, patchFrom(form, LIBRARY_EDITABLE, LIBRARY_KINDS));
    revalidatePath("/admin");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function updateExample(id: string, form: FormData): Promise<AdminResult> {
  const demo = guard();
  if (demo) return demo;
  try {
    await saveScriptExample(id, patchFrom(form, EXAMPLE_EDITABLE, EXAMPLE_KINDS));
    revalidatePath("/admin");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}
