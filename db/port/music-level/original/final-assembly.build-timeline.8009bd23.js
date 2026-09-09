// Build the request for OUR ffmpeg assemble endpoint (Railway). The server
// measures each clip itself and silence-pads every voiceover to its scene's
// exact video length; aspect picks the output canvas.
const clips = $('Prepare Clips').all();
if (!clips.length) throw new Error('No clips to assemble.');
const scenes = clips.map(c => ({
  videoUrl: c.json.url,
  audioUrl: (c.json.voiceUrl && c.json.voiceUrl.startsWith('http')) ? c.json.voiceUrl : undefined,
}));
const sceneChapters = clips.map(c => c.json.chapter || 0);

// Aspect resolution order: trigger input -> webhook body -> project field
// -> 16:9. Reading a nonexistent Airtable field is safely undefined.
let trig = {};
try { if ($('Receive Project ID').isExecuted) trig = $('Receive Project ID').first().json; } catch (e) {}
try { if (!trig.Aspect && $('Normalize Assemble Input').isExecuted) trig = $('Normalize Assemble Input').first().json; } catch (e) {}
const pf = ($('Fetch Project Info').first().json.fields) || {};
const aspect = (trig.Aspect === '9:16' || pf['Format'] === '9:16') ? '9:16' : '16:9';

let opts = {};
try { opts = JSON.parse(pf['Editing Options'] || '{}') || {}; } catch (e) {}

// TWO independent switches, both sent explicitly — the server's implicit
// defaults must never decide this.
//
// sfx: the Scene Final URL clips are RAW Veo output, so their audio track is
// Veo's generated ambience (the submit prompt bans speech and music, leaving
// natural sound effects only). ON → mixed at SFX_LEVEL under the narration,
// sidechain-ducked server-side so narration stays predominant. Default ON:
// silent footage under a voice sounds dead.
//
// SFX_LEVEL was 0.25 and judged too subtle on a real SFX-only render
// (Warhammer, 2026-08-10) — audible only in headphones, in the gaps. 0.35
// lifts the effects without touching the ducking, so the voice still wins
// whenever it speaks. It is now the DEFAULT rather than the only value: the
// brief's SFX row carries a volume slider, stored as Editing Options.sfxLevel,
// and a film that wants more or less says so. Refuses rather than guesses —
// out of range or unparseable falls back here, so a bad value can never reach
// the mixer. The same rule lives in platform/lib/data/derive.ts and in the
// orchestrator's 'Normalize Webhook Input'; change one, change all three.
const SFX_LEVEL = 0.35;
const sfxOn = opts.sfx !== false;
const sfxLevel = (() => {
  const n = Number(opts.sfxLevel);
  return (Number.isFinite(n) && n >= 0.05 && n <= 1) ? Math.round(n * 100) / 100 : SFX_LEVEL;
})();

// music: a background track from the Drive 'Muzica' folder AND the
// synthesized boom/whoosh/riser accents at hook, chapter cuts and end
// screen. Neither comes from the scene — both are composed here — so they
// share one opt-IN switch. The accents used to play unconditionally, which
// is how a film ended up carrying music unrelated to its footage.
const musicOn = opts.music === true;
let musicUrl;
if (musicOn) {
  try { musicUrl = $('Pick Music Track').first().json.url || undefined; } catch (e) {}
}

// The canvas this film is built on. 720p unless the project says otherwise,
// and only /upscale-film says otherwise — because a 1080p montage made of
// 720p clips buys bytes and nothing else. It is emitted at the top level too,
// so Submit Graphics and Graphics Guard read the SAME value rather than
// deriving it again: the montage and the graphics drawn over it must agree on
// the canvas, and the poll ceiling has to know the render costs 2.09x.
const resolution = opts.resolution === '1080p' ? '1080p' : '720p';

// The gap between the end of a scene's narration and the cut to the next
// scene. 0.35s for every category — the montage's classic breath — except
// Kids story, whose narration_pace asks for real pauses so young listeners
// can follow (relaxed 0.8s, read-along 1.2s, in film time: the whole-film
// retime then stretches those too). /assemble clamps to [0.2, 2] and falls
// back to 0.35, so a malformed value cannot stall the film.
const sceneGap = (() => {
  if (opts.category !== 'kids') return 0.35;
  return String((opts.categoryOptions || {}).narration_pace || '') === 'very_slow' ? 1.2 : 0.8;
})();

return [{ json: { body: {
  scenes,
  sceneChapters,
  musicUrl,
  aspect,
  resolution,
  nativeAudio: sfxOn ? sfxLevel : false,
  stingers: musicOn,
  sceneGap,
}, resolution, sceneCount: scenes.length, tone: pf.Tonalitate || 'default', aspect, musicUrl: musicUrl || null, sfx: sfxOn, sfxLevel: sfxOn ? sfxLevel : 0, music: musicOn } }];