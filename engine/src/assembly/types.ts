// The shapes Final Assembly reads and writes. Inputs are the `hov.at_*` views
// exactly as n8n's Postgres nodes return them (Airtable-shaped: `{id,
// createdTime, fields}` with the Romanian field names), because phase 1's
// contract is "identical to the n8n bodies" and the views are what they read.

export type Fields = Record<string, any>;

/** One row of hov.at_scene / hov.at_project / hov.at_script. */
export interface AtRow {
  id: string;
  createdTime?: string;
  fields?: Fields;
}

/** What the trigger hands downstream: the sub-workflow inputs, or the webhook body normalised. */
export interface Trigger {
  Project_ID?: string;
  Aspect?: string;
  No_Captions?: string;
}

/**
 * The two ways a Final Assembly run starts. n8n distinguishes them by which
 * node executed, and two nodes resolve them in slightly different orders
 * (see resolveTrigger), so both are carried rather than pre-merged.
 */
export interface Triggers {
  /** `Receive Project ID` — the orchestrator's Execute Workflow path (disconnected since 2026-09-02). */
  receive?: Trigger;
  /** `Normalize Assemble Input` — the site's `assemble` webhook. */
  normalize?: Trigger;
}

/** One output item of Prepare Clips. */
export interface Clip {
  id: string;
  url: string;
  voiceUrl: string;
  narratorText: string;
  chapter: number;
  order: number | null;
  seconds: number | null;
}

/** A Drive `files.list` entry. */
export interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
}

/** Pick Music Track's output. `url: null` means no track. */
export interface MusicPick {
  id?: string;
  name: string | null;
  matched?: string;
  url: string | null;
  reason?: string;
}

/** The assemble server's measurement of what it built (`/assemble/:id/status` → verify). */
export interface Verify {
  videoSeconds?: number;
  sceneStartsSeconds?: number[];
  voiceDurationsSeconds?: number[];
  [k: string]: unknown;
}

/** `/assemble/:id/status` and `/render/:id/status` as the guards see them. */
export interface PollStatus {
  status?: string;
  error?: unknown;
  progress?: number;
  outputUrl?: string;
  verify?: Verify;
  [k: string]: unknown;
}
