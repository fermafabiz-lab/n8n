// Graphics pass: hook title, chapter markers, transitions, captions,
// grade and end screen over the ffmpeg-assembled video. Scene timings and
// real narration lengths come from the assemble step's own ffprobe
// verification, so captions pace with the actual voice.
const status = $('Render Guard').last().json; // {outputUrl, verify}
if (!status.outputUrl) throw new Error('assemble outputUrl missing');
const clips = $('Prepare Clips').all();
const v = status.verify || {};
const starts = v.sceneStartsSeconds || [];
const voices = v.voiceDurationsSeconds || [];
const total = v.videoSeconds || 0;
const scenes = clips.map((c, i) => {
  const start = starts[i] ?? (i * 8);
  const end = (i + 1 < starts.length) ? starts[i + 1] : total;
  return {
    narratorText: c.json.narratorText || '',
    startSeconds: start,
    durationSeconds: Math.max(0.5, end - start),
    chapter: c.json.chapter || 0,
    speechSeconds: voices[i] || undefined,
  };
});
const pf = $('Fetch Project Info').first().json.fields || {};

// Aspect + captions: trigger input -> webhook body -> project fields -> defaults.
let trig = {};
try { if ($('Receive Project ID').isExecuted) trig = $('Receive Project ID').first().json; } catch (e) {}
try { if (!trig.Aspect && !trig.No_Captions && $('Normalize Assemble Input').isExecuted) trig = $('Normalize Assemble Input').first().json; } catch (e) {}
const aspectRatio = (trig.Aspect === '9:16' || pf['Format'] === '9:16') ? '9:16' : '16:9';

// Per-overlay toggles chosen in the site form, stored as JSON on the
// project ('Editing Options'). Missing field/old projects = everything on.
let opts = {};
try { opts = JSON.parse(pf['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }

// How hard the montage re-frames across a cut. 0 holds ONE framing for the
// whole film; 1 and 2 contrast the framing at every scene boundary.
//
// Sent explicitly, and defaulting to 0, because omitting it made Remotion
// derive it from the tone's editing energy - which is 1 for most tones, so
// every film got the contrast whether it suited the footage or not. Measured
// on a 15-scene dialogue film: scale jumps of 0.075 to 0.135 plus a position
// shift, on all 14 boundaries. The planner is blind to the footage, and the
// contrast only reads as a new shot when consecutive scenes actually look
// different. On a two-hander every scene is the same two people in the same
// place, so it reads as a zoom of the same shot - reported three times as a
// zoom bug, and it was never a bug, it was this setting.
//
// Still a button, not a decision: a project that wants the contrast back sets
// montageIntensity in its Editing Options.
const montageIntensity = [0, 1, 2].includes(opts.montageIntensity) ? opts.montageIntensity : 0;

// A cinematic (silent) project's Script Scenă is an unspoken shot note, not
// narration. THREE surfaces read that field as if it were spoken, and each
// one puts the beat sheet on screen: captions print it, the chapter card
// borrows its first eight words when the chapter has no title of its own,
// and a text card lifts figures out of it (a year or a duration in a stage
// direction reads to the pattern exactly like a fact the narration speaks).
// Captions were the only one visible to the producer, which is how the other
// two survived. One flag now tells the render, and all three read it.
const narrationIsSpoken = opts.category !== 'cinematic';
const showCaptions = !(trig.No_Captions === 'yes' || pf['Fără Subtitrări'] === true) && narrationIsSpoken;

// Real chapter titles from the linked script's [CHAPTER n: title] markers.
const chapterTitles = {};
try {
  const sc = ($('Fetch Script Titles').first().json.fields || {})['Script Content'] || '';
  const re = /\[CHAPTER\s+(\d+)\s*:\s*([^\]]+)\]/g;
  let m;
  while ((m = re.exec(sc))) chapterTitles[m[1]] = m[2].trim();
} catch (e) {}

return [{ json: { body: {
  finalVideoUrl: status.outputUrl,
  projectTitle: pf['Nume Proiect'] || 'Video Factory',
  scenes,
  tone: pf['Tonalitate'] || 'Dark',
  channelName: 'Video Factory',
  aspectRatio,
  showCaptions,
  narrationIsSpoken,
  montageIntensity,
  // The cold open Scripting planned (style, beats, the one card its style
  // may draw). The render reads it defensively and a film without one opens
  // on its footage. The old showHookTitle switch is retired: the opening
  // title card is gone, replaced by the teaser (src/hook.ts).
  hookPlan: (opts.hookPlan && typeof opts.hookPlan === 'object') ? opts.hookPlan : undefined,
  showChapterCards: opts.chapterCards !== false,
  // The producer's "drawn cards" switch, which until now silenced only HALF of
  // what it names. It gates the motif chain in Scripting and `Attach Motif
  // Cards` here — but the render DERIVES its own cards from the narration when
  // no explicit `textCards` arrive, and that derivation was never gated by
  // anything. So a film with the switch off still drew a figure card: a year,
  // set large, in the middle of the frame. Measured 2026-09-12 across the 18
  // most recent films — seventeen carried no motif card at all, six of them
  // because the switch was off — which is why every one of them showed the
  // same year card and the producer reported "pe absolut fiecare videoclip
  // este aceeasi animatie". Off now means no cards of any kind, and it takes
  // effect on films already made, with no re-scripting. Absent still means on.
  showTextCards: opts.drawnCards !== false,
  showEndScreen: opts.endScreen !== false,
  chapterTitles,
} } }];
