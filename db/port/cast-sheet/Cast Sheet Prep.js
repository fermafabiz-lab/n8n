// One reference portrait per character, made once per film.
//
// The n-1 chain carries a face from scene to scene, and it was measured
// working — the same man survives 71 scenes of the Boyd film. What it cannot
// do is carry a CAST: the reference is whoever was in the last frame, so on a
// two-hander every scene tells the model to take one man's identity from a
// picture of the other, and a character who appears every fifth scene has no
// anchor at all. A sheet gives each character one fixed appearance that does
// not have to travel.
//
// Free on this plan (Flow image generation spends no Google AI credits on the
// Ultra account), one call per character, once per film: `castRefs` is stored
// on the project, so later passes find it and this node emits nothing.
const proj = $('IMG Load Project').first().json;
const f = proj.fields || {};
let opts = {};
try { opts = JSON.parse(f['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }
const refs = (opts.castRefs && typeof opts.castRefs === 'object') ? opts.castRefs : {};
let bible = {};
try { bible = JSON.parse(f['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
const chars = Array.isArray(bible.characters) ? bible.characters : [];
const rb = $('Receive Batch Input').first().json;
const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';
const MODEL = 'nano-banana-2';

const work = [];
for (const c of chars) {
  const name = String((c || {}).name || '').trim();
  const desc = String((c || {}).visual_description || '').trim();
  if (!name || !desc) continue;
  if (refs[name]) continue;
  // Four is already more principals than a short film can hold; past that the
  // sheets cost Flow calls for people the script mentions once.
  if (work.length >= 4) break;
  work.push({
    name: name,
    requestBody: {
      email: rb.Flow_Email || 'fermafabiz@gmail.com',
      model: MODEL,
      prompt:
        'Character reference portrait of ONE person, centred, front three-quarter view, plain neutral studio backdrop, even soft lighting, no props, no text, no collage: ' +
        desc +
        ' If the description offers alternatives for different eras or scenes, use the FIRST one only — one person, one outfit, one age. Photorealistic, natural skin texture, sharp focus.',
      aspectRatio: aspect,
      count: 1,
      captchaRetry: 1,
    },
  });
}
// NEVER return zero items: everything downstream of this node is the rest of
// the batch, and an empty output would end the pass silently. The flag is what
// Cast Sheet? routes on.
if (!work.length) return [{ json: { skip: true, castRefs: refs } }];
return work.map((w) => ({ json: w }));
