// The website POSTs JSON; the form trigger outputs flat fields. Map the
// webhook body to the exact shape 'Create Project in Airtable' expects.
const b = $json.body || {};
const catOpts = (b.category_options && typeof b.category_options === 'object') ? b.category_options : {};
// Cast of extra voices for multi-voice videos. Empty (the default and every
// older project) means narrator-only, i.e. today's behaviour.
const cast = Array.isArray(b.cast_voices) ? b.cast_voices.filter(v => typeof v === 'string' && v) : [];
// Two modes: 'characters' (the cast speaks its own lines) and 'chapters'
// (each chapter is read by a different narrator from the cast).
const mvRaw = String(catOpts.multi_voice || 'off');
const multiVoiceMode = (cast.length > 0 && (mvRaw === 'characters' || mvRaw === 'chapters')) ? mvRaw : 'off';
// The exact playback rate the brief's PACE control chose. `pace` below stays
// the WORD, because two writing prompts in Claude Scripting interpolate it —
// but a word cannot tell 0.8 from 0.9, so the number travels separately and
// ends up in Editing Options, where Build Remotion Props reads it.
// The same refusal rule as normalizeSpeed() in remotion/server/speed.mjs and
// platform/lib/data/derive.ts: out of range, unparseable, or within 0.01 of 1
// means leave the film at its natural rate rather than guess. Three copies
// because it runs in three languages — change one, change all three.
const speed = (() => {
  const n = Number(b.speed);
  return (Number.isFinite(n) && n >= 0.5 && n <= 2 && Math.abs(n - 1) >= 0.01) ? n : 1;
})();
// How loud the scenes' own ambience sits under the narration, 0-1, chosen on
// the brief's SFX row. 0.35 is the level Build Timeline used to hard-code, so
// an untouched slider reproduces every film made before this existed.
// Refuses rather than guesses, exactly like speed above: out of range or
// unparseable falls back to the default. The floor is 0.05 and not 0 because
// silence is what the sfx switch is for — a level of 0 would be a second,
// hidden off switch that can disagree with the visible one.
const sfxLevel = (() => {
  const n = Number(b.sfx_level);
  return (Number.isFinite(n) && n >= 0.05 && n <= 1) ? Math.round(n * 100) / 100 : 0.35;
})();
// How loud the background track sits under the voice, 0-1, chosen on the
// brief's Music row. 0.22 is the gain assemble.mjs has always used for the
// music bed, so an untouched slider reproduces every film made before this
// existed. Same refusal rule and the same floor as sfxLevel; the same three
// copies (platform/lib/data/derive.ts, Final Assembly's Build Timeline).
const musicLevel = (() => {
  const n = Number(b.music_level);
  return (Number.isFinite(n) && n >= 0.05 && n <= 1) ? Math.round(n * 100) / 100 : 0.22;
})();
// The colour a spoken caption word is painted. Stored ONLY when it is a real
// hex: absent has to keep meaning the white default, which is what most films
// should be — white with the spoken word marked by brightness is the only
// choice that reads on every kind of footage. Mirrors resolveCaptionAccent()
// in remotion/src/captionColor.ts, which has the final say and additionally
// lifts a too-dark accent until it clears a luminance floor.
const captionColor = (() => {
  const raw = String(b.caption_color || '').trim();
  if (!raw || /^(none|white|off)$/i.test(raw)) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return '#' + h.toUpperCase();
})();
// How the narrator READS, as the brief chose it. Stored ONLY when it is
// present: the absence of this key is what tells every synthesis path to leave
// each voice's own ElevenLabs settings alone, so writing a default here would
// silently override the tuning of every voice the pipeline ever uses.
// Clamped rather than refused, because this is the WRITE side — the readers
// (AB Speak, Speak VR, VR Speak, /tts-multi) refuse anything out of range, so
// a bad value must not be allowed to reach them in the first place.
const voiceTone = (() => {
  const v = b.voice_tone;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const u = (x, d) => { const n = Number(x); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d; };
  if (!['stability', 'similarity', 'style'].some(k => Number.isFinite(Number(v[k])))) return null;
  return { stability: u(v.stability, 0.5), similarity: u(v.similarity, 0.75), style: u(v.style, 0), speakerBoost: v.speakerBoost !== false };
})();
// An episode of a series (db/012, platform/lib/series.ts). The site sends
// the show's id and its REFERENCE SHEETS — the castRefs / castSheets /
// objectRefs / locationRefs / locationPlates the consistency chain wrote on
// the film the series was started from. Stored into Editing Options HERE,
// not by a site write after creation, for the same reason createdBy is:
// `Merge Ref Into Options` rebuilds the whole blob from this node's value.
// With them in place `Cast Sheet Prep` and `Set Plate Prep` skip every name
// that already has a sheet, so the same faces anchor every episode. The
// show's bible travels separately, as Lore. Only plain name → value maps
// are taken, and only under the five known keys; anything else is dropped.
const seriesRefs = (() => {
  const sr = (b.series && typeof b.series === 'object') ? b.series : null;
  if (!sr || !/^rec[A-Za-z0-9]{14}$/.test(String(sr.id || ''))) return {};
  const refs = (sr.refs && typeof sr.refs === 'object' && !Array.isArray(sr.refs)) ? sr.refs : {};
  const out = { seriesId: String(sr.id) };
  for (const k of ['castRefs', 'castSheets', 'objectRefs', 'locationRefs', 'locationPlates']) {
    const v = refs[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) out[k] = v;
  }
  return out;
})();
return [{ json: {
  tema: b.tema || b.name || b['Nume Proiect'] || 'Untitled',
  tonalitate: b.tonalitate || b.tone || b.Tonalitate || 'Dark',
  pace: b.pace || b.Pace || 'Normal',
  length: Number(b.length || b.Lenght) || 64,
  style: b.style || b.Style || '',
  language: b.language || b.Language || 'English',
  voice: b.voice_id || b.voice || '',
  aspect: b.aspect === '9:16' ? '9:16' : '16:9',
  noCaptions: b.captions === 'no' || b.captions === false,
  // Optional canon/lore text for niche topics (Backrooms levels, SCP...) —
  // injected into the Story Bible as ground truth.
  lore: String(b.lore || '').slice(0, 8000),
  // Producer-uploaded reference photo for the film's FIRST scene: base64
  // rides the webhook, gets uploaded to Drive right after the record is
  // created, and its URL lands in Editing Options as refImage.
  refImage: (b.reference_image && typeof b.reference_image === 'object' && typeof b.reference_image.data === 'string' && b.reference_image.data.length > 100) ? { type: String(b.reference_image.type || 'image/jpeg'), data: String(b.reference_image.data) } : null,
  // Per-overlay editing toggles + the video category, its options and the
  // voice cast — all stored as one JSON on the project ('Editing Options'),
  // read back by whichever workflow implements each feature. Unknown keys
  // are inert, so 'story' without multi-voice behaves exactly as before.
  editingOptions: JSON.stringify({
    // The cold open's STYLE (2026-09-11) — 'auto' lets Claude Scripting
    // choose among the six, a named one forces it. Whitelisted here AND in
    // derive.ts (HOOK_STYLES) AND in Voice Mode, because the string becomes
    // the rule the hook prompt is told to obey. Absent stores nothing, which
    // Voice Mode reads as 'auto'. The old hook_title switch is retired: the
    // opening title card is gone and every film opens on a teaser.
    ...((() => { const s = String(b.hook_style || '').trim().toLowerCase(); return ['auto', 'teaser', 'question', 'figure', 'slate', 'action', 'cliffhanger'].includes(s) ? { hookStyle: s } : {}; })()),
    chapterCards: b.chapter_cards !== 'no',
    endScreen: b.end_screen !== 'no',
    // The clips' own ambience is the footage's natural sound, so it is ON
    // unless explicitly refused. Music is the opposite — a background track
    // and the synthesized whoosh/boom accents are composed here and have no
    // relationship to what is on screen, so nothing plays unless asked.
    sfx: !(b.sfx === 'no' || b.sfx === false),
    sfxLevel,
    music: b.music === 'yes' || b.music === true,
    musicLevel,
    // Hands-off mode: the project page approves every gate by itself while
    // it is open, through the site's own actions. n8n never reads this key
    // — the gates keep polling the same checkboxes; only WHO ticks them
    // changes. Stored here so the flag exists from the project's first
    // second, before AutoPilot has ever mounted.
    //
    // And WHICH gates (2026-09-24): `auto_approve_steps` is some of script,
    // scenes, audio, images, video, final — comma-separated, unknown entries
    // dropped, pipeline order kept. The list must equal AUTO_STEPS in the
    // site's lib/hands-off.ts (db/port/hands-off-steps/check.mjs asserts it).
    // Stored only when the brief SENT the field, so a film from a site that
    // predates the choice keeps only the switch, which the site reads as
    // every step — what that switch always meant. When the list is sent the
    // switch follows it, so the two can never disagree.
    ...((() => {
      const on = b.auto_approve === 'yes' || b.auto_approve === true;
      if (b.auto_approve_steps === undefined || b.auto_approve_steps === null) return { autoApprove: on };
      const raw = Array.isArray(b.auto_approve_steps) ? b.auto_approve_steps : String(b.auto_approve_steps).split(',');
      const want = new Set(raw.map(x => String(x).trim()));
      const steps = ['script', 'scenes', 'audio', 'images', 'video', 'final'].filter(st => want.has(st));
      return { autoApprove: steps.length > 0, autoApproveSteps: steps };
    })()),
    // Permission for the pipeline to draw cards at all. Deliberately NOT the
    // same key as motifCards, which is the LIST Scripting chooses later: an
    // empty list means it found nothing worth drawing, which is a different
    // fact from the producer saying no.
    drawnCards: b.drawn_cards !== 'no',
    // How often the source badge opens into its full label (2026-09-19).
    // 'yes' = the first shot of each kind says ARCHIVAL FOOTAGE in full and
    // every later run of that kind keeps just the mark; absent or 'no' = every
    // run announces itself, which is the default and what every film made
    // before today has. Strictly 'yes': absence must never quieten a film's
    // provenance labels by itself, the same rule derive.ts applies on the read
    // side with `=== true`.
    //
    // Stored HERE rather than by a site write after creation, for exactly the
    // reason createdBy is: `Merge Ref Into Options` rebuilds the whole blob
    // from THIS node's value seconds after the webhook answers, so anything
    // merged in between is wiped on any film carrying a reference photo. That
    // is the hole `sourceWatermark` still has (docs/lessons-site.md) and the
    // one this key deliberately does not walk into.
    watermarkOpenOnce: b.watermark_open_once === 'yes' || b.watermark_open_once === true,
    // And how big it is drawn (2026-09-19), as a multiplier of the base size.
    // Refused rather than clamped, the same rule in all three languages that
    // touch this number — platform/lib/provenance.ts, remotion's copy, and
    // Final Assembly's `Source Watermark` node. An out-of-range value is a
    // mistake, so it resolves to the standard size rather than to the nearest
    // end; absent stores 1, which every film before this was drawn at.
    watermarkScale: (() => { const n = Number(b.watermark_scale); return (Number.isFinite(n) && n >= 0.7 && n <= 1.6) ? n : 1; })(),
    ...(captionColor ? { captionColor } : {}),
    // How the graphics move (2026-09-24, docs/plans/motion-packs.md). Stored
    // ONLY when it is one of the four packs: absent is "Auto", and the render
    // then uses the category's default (Editorial for Story), so a default
    // changed later still reaches every film that never chose. Same ids in
    // platform/lib/motion-packs.ts and remotion/src/motion/packs.ts.
    ...((() => { const s = String(b.motion_pack || '').trim(); return ['classic', 'editorial', 'punch', 'lowerThird'].includes(s) ? { motionPack: s } : {}; })()),
    // Which graphics ride over the footage — name tags, figures, chapter
    // openings (2026-09-25, db/port/graphic-styles/). Stored ONLY when the
    // producer picked one: absent is "AI picks", and the graphic-plan
    // workflow then chooses by the film's theme. Same ids in
    // platform/lib/graphic-styles.ts and remotion/src/graphics/styles.ts.
    // Kids story and Cinematic have their own six (2026-09-25).
    ...((() => { const s = String(b.graphic_style || '').trim(); return ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten', 'kidsStorybook', 'kidsPlayful', 'kidsAll', 'cineFilm', 'cineNeon', 'cineMemory'].includes(s) ? { graphicStyle: s } : {}; })()),
    // How the picture hands over at the cuts that get a transition
    // (2026-09-25, db/port/transitions/). Stored ONLY when the producer picked
    // one — 'none' included, which is a real choice (hard cuts). Absent is
    // "AI picks": the graphic-plan workflow chooses a family by theme. Same
    // ids in platform/lib/transition-styles.ts and remotion/src/transitions/.
    ...((() => { const s = String(b.transition_style || '').trim(); return ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'].includes(s) ? { transitionStyle: s } : {}; })()),
    // Which Veo tier generates the clips. Whitelisted here AND on the
    // site (VIDEO_MODELS in derive.ts): the string reaches the Flow API
    // verbatim from Current Scene, and an unknown id kills a batch
    // slowly. Absent/free stores nothing — absence means the free
    // default, exactly like captionColor's white.
    ...(['veo-3.1-lite','veo-3.1-fast','veo-3.1-quality'].includes(String(b.video_model || '')) ? { videoModel: String(b.video_model) } : {}),
    // Parallel clip generation across the linked Google Flow accounts. Until
    // 2026-09-20 these two keys existed only in the pipeline and had to be
    // typed into Editing Options by hand, so the accounts the producer paid
    // for were unreachable from the site; the brief's "Clip generation"
    // control writes them both now.
    //
    // They are separate keys because they are separate mechanisms, and only
    // together do they mean "the film finishes sooner": flowAccounts cuts the
    // scenes into one consecutive block per account, which by itself only
    // stops useapi answering 429 to back-to-back submits on one account;
    // videoPool is the half that keeps a Veo job in flight on each account at
    // the same time. Measured on the same nine scenes, 2026-09-18: 10m05 with
    // both on against 13m12 one at a time.
    //
    // flowAccounts is a CEILING. `Assign Accounts` lowers it by itself when
    // the film's cast sheets and set plates have not been replicated onto
    // every account, because a clip built from a reference its own account
    // does not own comes back `Email mismatch`. Refused rather than clamped,
    // and 1 is the value every film had before the accounts existed — the
    // same rule as the site's normalizeFlowAccounts, which must agree with
    // the `ACCOUNTS` list in Assign Accounts.
    flowAccounts: (() => { const n = Number(b.flow_accounts); return (Number.isInteger(n) && n >= 1 && n <= 3) ? n : 1; })(),
    // Strict, like endFrame: the pool changes how a film is produced, so a
    // stray truthy value must not switch it on.
    videoPool: b.video_pool === 'yes' || b.video_pool === true,
    // The producer's own words about what this film IS — and the 2-3 things
    // it MUST contain. Stored on the project (unlike Lore, which a restart
    // loses) so restart-scripting keeps the direction. The Scripting prompts
    // read both from Editing Options via Fetch Project Record, and the
    // Narration Guard VERIFIES each must-include after writing — an
    // instruction in a prompt is not a constraint.
    ...(String(b.brief || '').trim() ? { producerBrief: String(b.brief).trim().slice(0, 2000) } : {}),
    ...((Array.isArray(b.must_haves) ? b.must_haves : []).map(x => String(x).trim()).filter(Boolean).length ? { mustInclude: (Array.isArray(b.must_haves) ? b.must_haves : []).map(x => String(x).trim()).filter(Boolean).slice(0, 3).map(x => x.slice(0, 200)) } : {}),
    // Library scripts the producer pinned as WRITING references — record ids,
    // in order, at most three. `/api/style-refs` puts them first when Claude
    // Scripting fetches its style rows; absent keeps the tone match. Same
    // validation as normalizeStyleRefs() in platform/lib/style-refs.ts.
    ...((() => { const ids = (Array.isArray(b.style_refs) ? b.style_refs : []).map(x => String(x || '').trim()).filter(x => /^rec[A-Za-z0-9]{14}$/.test(x)); const u = [...new Set(ids)].slice(0, 3); return u.length ? { styleRefs: u } : {}; })()),
    speed,
    // Who on the team started this film (2026-09-15). Four names, whitelisted
    // here AND on the site (CREATORS in platform/lib/data/derive.ts) — change
    // one, change both. NOTHING in the pipeline reads it: no prompt, no gate,
    // no render. It is a scoreboard, and it is stored HERE rather than by a
    // site write after creation because `Merge Ref Image` rebuilds the whole
    // Editing Options from this node's value, so anything merged in later is
    // wiped on any film that carries a reference photo.
    // Absent stores nothing, which is what every film made before today has
    // and what the site shows as no name rather than guessing an owner.
    ...(['Alex','Dan','David','Iustin'].includes(String(b.created_by || '')) ? { createdBy: String(b.created_by) } : {}),
    category: String(b.category || 'story'),
    categoryOptions: catOpts,
    multiVoiceMode,
    cast,
    ...(voiceTone ? { voice: voiceTone } : {}),
    ...seriesRefs,
  }),
} }];