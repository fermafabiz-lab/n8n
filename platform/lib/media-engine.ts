/**
 * Per-scene media work on the ENGINE (engine/, hov.media_job — db/017),
 * instead of an n8n webhook. Voice first (docs/plans/engine-media-generation.md,
 * phase 2); images and clips follow the same shape.
 *
 * WHO does a voice take is `VOICE_ENGINE` on the site: `code` = the engine,
 * anything else = n8n's `scene-voice-regen`, exactly as before. The same
 * switch-and-rollback as FINAL_ASSEMBLY_ENGINE (lib/assembly-engine.ts).
 *
 * The engine writes the scene itself when it finishes — the take, the status,
 * and `Regenerează Voce: false` — and on a failure it releases the flag and
 * writes why, so a regeneration can no longer be stranded by a dead run.
 */
import { atQuery, isConfigured } from "@/lib/data/postgres";

export const voiceEngine = (): "code" | "n8n" =>
  process.env.VOICE_ENGINE === "code" ? "code" : "n8n";

/**
 * Queue one voice take. `voiceId` is the audio panel's per-scene pin, which
 * beats the mode's rule for this take (the engine honours it; n8n's picker
 * never read it). A take already in flight for the scene is not duplicated —
 * the database refuses the second — and that is reported as success, because
 * the flag the producer is looking at is already being worked on.
 */
export async function queueVoiceTake(
  sceneId: string,
  voiceId: string | undefined,
  requestedBy: string,
): Promise<"sent" | "already"> {
  if (!isConfigured) throw new Error("The database is not configured.");
  const rows = await atQuery<{ id: string }>(
    `insert into hov.media_job (project_id, scene_id, kind, request, requested_by)
     select s.project_id, s.id, 'voice', $2::jsonb, $3 from hov.scene s where s.id = $1
     on conflict (scene_id, kind) where phase in ('queued', 'running') do nothing
     returning id::text`,
    [sceneId, JSON.stringify(voiceId && voiceId.includes("_") ? { voice_id: voiceId } : {}), requestedBy],
  );
  return rows[0] ? "sent" : "already";
}

/** Stop the scene's take in flight, if any. The engine lets go at its next heartbeat. */
export async function stopVoiceTake(sceneId: string): Promise<number> {
  if (!isConfigured) return 0;
  try {
    const rows = await atQuery(
      `update hov.media_job set phase = 'stopped', finished_at = now()
        where scene_id = $1 and kind = 'voice' and phase in ('queued', 'running') returning id`,
      [sceneId],
    );
    return rows.length;
  } catch {
    return 0; // db/017 not applied: nothing of the engine's can be running
  }
}
