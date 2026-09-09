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
    hookTitle: b.hook_title !== 'no',
    chapterCards: b.chapter_cards !== 'no',
    endScreen: b.end_screen !== 'no',
    // The clips' own ambience is the footage's natural sound, so it is ON
    // unless explicitly refused. Music is the opposite — a background track
    // and the synthesized whoosh/boom accents are composed here and have no
    // relationship to what is on screen, so nothing plays unless asked.
    sfx: !(b.sfx === 'no' || b.sfx === false),
    sfxLevel,
    music: b.music === 'yes' || b.music === true,
    // Hands-off mode: the project page approves every gate by itself while
    // it is open, through the site's own actions. n8n never reads this key
    // — the gates keep polling the same checkboxes; only WHO ticks them
    // changes. Stored here so the flag exists from the project's first
    // second, before AutoPilot has ever mounted.
    autoApprove: b.auto_approve === 'yes' || b.auto_approve === true,
    // Permission for the pipeline to draw cards at all. Deliberately NOT the
    // same key as motifCards, which is the LIST Scripting chooses later: an
    // empty list means it found nothing worth drawing, which is a different
    // fact from the producer saying no.
    drawnCards: b.drawn_cards !== 'no',
    ...(captionColor ? { captionColor } : {}),
    // Which Veo tier generates the clips. Whitelisted here AND on the
    // site (VIDEO_MODELS in derive.ts): the string reaches the Flow API
    // verbatim from Current Scene, and an unknown id kills a batch
    // slowly. Absent/free stores nothing — absence means the free
    // default, exactly like captionColor's white.
    ...(['veo-3.1-lite','veo-3.1-fast','veo-3.1-quality'].includes(String(b.video_model || '')) ? { videoModel: String(b.video_model) } : {}),
    // The producer's own words about what this film IS — and the 2-3 things
    // it MUST contain. Stored on the project (unlike Lore, which a restart
    // loses) so restart-scripting keeps the direction. The Scripting prompts
    // read both from Editing Options via Fetch Project Record, and the
    // Narration Guard VERIFIES each must-include after writing — an
    // instruction in a prompt is not a constraint.
    ...(String(b.brief || '').trim() ? { producerBrief: String(b.brief).trim().slice(0, 2000) } : {}),
    ...((Array.isArray(b.must_haves) ? b.must_haves : []).map(x => String(x).trim()).filter(Boolean).length ? { mustInclude: (Array.isArray(b.must_haves) ? b.must_haves : []).map(x => String(x).trim()).filter(Boolean).slice(0, 3).map(x => x.slice(0, 200)) } : {}),
    speed,
    category: String(b.category || 'story'),
    categoryOptions: catOpts,
    multiVoiceMode,
    cast,
    ...(voiceTone ? { voice: voiceTone } : {}),
  }),
} }];