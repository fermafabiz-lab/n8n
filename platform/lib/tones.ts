// The twelve tones a film can be written in. A tone is a WRITING profile —
// structure, voice, words per minute — not a look: `Style` is the look.
//
// One owner, because three places read the list: the brief's chip row, the
// per-category default on each entry in `categories.ts`, and the check that
// pins both. It used to live inside NewVideoForm, where nothing could import
// it.
//
// **Every name here has a row in `hov.genre_profile`**, matched
// case-insensitively — a tone without one is written with Claude Scripting's
// built-in DOCUMENTARY fallback, and nothing says so on screen or in the log.
// Verified 2026-09-19, all twelve present and `active`:
//
//   select id, tone, active from hov.genre_profile order by lower(tone);
//
// So adding a tone here is the SECOND half of the job — insert its profile
// row first (db/port/childish-tone/ is the worked example), then re-run that
// query and update the date above.
export const TONES = [
  "Epic",
  "Educativ",
  "Cinematic",
  "Corporate",
  "Emotional",
  "Dark",
  "Conspiracy",
  "Horror",
  "Dramatic",
  "Documentary",
  "Motivational",
  "Childish",
] as const;

/**
 * A tone the pipeline can actually write. Every `defaultTone` in
 * `categories.ts` is typed as this, so a misspelling is a build error rather
 * than a film quietly written with the DOCUMENTARY fallback.
 */
export type Tone = (typeof TONES)[number];
