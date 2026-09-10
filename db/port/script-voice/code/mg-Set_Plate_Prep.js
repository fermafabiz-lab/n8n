// One establishing plate per bible location, once per film.
//
// The location's visual_description is pasted into every prompt set there,
// and prose keeps the palette and the materials but not the GEOMETRY: the
// same warehouse came back with a different floor plan in every scene. A
// plate is a wide, empty, evenly lit picture of the place that every scene
// there is anchored to — same architecture, same layout, same landmarks —
// while the text still sets the hour, the weather and the framing. Neutral
// overcast light on purpose: a dawn plate would drag a night scene's light
// the wrong way. Free on the Ultra plan; ids stored on the project as
// `locationRefs`, so a later pass makes nothing.
const proj = $('IMG Load Project').first().json;
const f = proj.fields || {};
let opts = {};
try { opts = JSON.parse(f['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }
const have = (opts.locationRefs && typeof opts.locationRefs === 'object') ? opts.locationRefs : {};
let bible = {};
try { bible = JSON.parse(f['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
const locs = Array.isArray(bible.locations) ? bible.locations : [];
const rb = $('Receive Batch Input').first().json;
const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';
const work = [];
for (const l of locs) {
  const name = String((l || {}).name || '').trim();
  const desc = String((l || {}).visual_description || '').trim();
  if (!name || !desc || have[name]) continue;
  // Ten, not six: a place that changes over the story is now listed once
  // per STATE in the bible ("Burj Al Arab — 1998, half-clad frame"), so a
  // construction film legitimately carries more entries than a drama. Each
  // plate is one free Flow image, made once per film.
  if (work.length >= 10) break;
  work.push({ name: name, requestBody: {
    email: rb.Flow_Email || 'fermafabiz@gmail.com',
    model: 'nano-banana-2',
    prompt: 'Establishing reference plate of ONE location, wide shot at eye level, completely empty of people and vehicles, soft neutral overcast daylight without strong shadows so every part of the place reads clearly, photorealistic, sharp focus, no text, no labels: ' + desc + ' Show the whole layout in one frame — what stands at the centre, on the left, on the right and in the background — and the materials, colours and landmarks that identify this exact place.',
    aspectRatio: aspect, count: 1, captchaRetry: 1,
  } });
}
if (!work.length) return [{ json: { skip: true } }];
return work.map((w) => ({ json: w }));