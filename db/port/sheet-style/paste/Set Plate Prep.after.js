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
// The film's look, resolved exactly the way `Voice Mode` (Claude Scripting)
// resolves the prefix it puts at the head of every scene's image_prompt. A
// kids film's sheets and plates are drawn in that same style: a reference
// is the strongest instruction the image model gets, and a photorealistic
// portrait anchoring a watercolour film pulls every frame toward photography
// — then the consistency judge, comparing frame to sheet, re-rolls the
// correctly drawn frame in STRICT MATCH mode, where the references win.
// Every other category keeps the photorealistic wording byte for byte.
// KIDS_STYLES is a copy of the table in `Voice Mode` and must stay identical
// to it — three copies in all: Voice Mode, Cast Sheet Prep, Set Plate Prep
// (db/port/sheet-style/check.mjs asserts the two here match the file it
// keeps of Voice Mode's).
const KIDS_STYLES = {
  // --- 2D ---
  illustrated: "Children's storybook illustration, soft watercolor and gouache textures, warm pastel palette, rounded friendly character shapes, gentle diffuse lighting",
  crayon: "Children's crayon and chalk drawing, thick waxy strokes, visible paper tooth, bright primary colours, joyful naive proportions",
  papercut: 'Paper cut-out collage animation still, layered coloured paper with visible torn edges and soft drop shadows, flat storybook depth, warm craft-paper palette',
  cel: 'Classic hand-painted 2D cel animation still for children, clean confident ink outlines, flat gouache colour fills, painted background art, warm saturated palette',
  // --- 3D ---
  cartoon3d: 'High-quality 3D animated film still for children, soft rounded character design, expressive friendly faces, vivid warm colors, cinematic soft lighting',
  brick: 'Scene built from interlocking plastic toy bricks, glossy moulded minifigures with cylindrical hands and printed smiling faces, visible studs and brick seams, bright primary colours, macro toy photography lighting',
  clay: 'Stop-motion clay animation still, hand-modelled plasticine characters with visible fingerprints and sculpting marks, soft matte surfaces, miniature handcrafted set, warm practical lighting',
  felt: 'Needle-felted wool and soft-toy animation still, fuzzy fibre textures, hand-stitched seams and button eyes, cosy handmade miniature set, warm soft lighting',
};
const catOpts = (opts.categoryOptions && typeof opts.categoryOptions === 'object') ? opts.categoryOptions : {};
const kidsStyleKey = Object.prototype.hasOwnProperty.call(KIDS_STYLES, String(catOpts.visual_style || '')) ? String(catOpts.visual_style) : 'illustrated';
const kidsStyle = String(opts.category || '') === 'kids' ? KIDS_STYLES[kidsStyleKey] : '';
// The first words of every sheet prompt are the first words of every scene.
const styleHead = kidsStyle ? kidsStyle + '. ' : '';
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
    prompt: styleHead + 'Establishing reference plate of ONE location, wide shot at eye level, completely empty of people and vehicles, soft neutral overcast daylight without strong shadows so every part of the place reads clearly, ' + (kidsStyle ? 'drawn in exactly that style, the same medium as every frame of the film, clean and sharp' : 'photorealistic, sharp focus') + ', no text, no labels: ' + desc + ' Show the whole layout in one frame — what stands at the centre, on the left, on the right and in the background — and the materials, colours and landmarks that identify this exact place.',
    aspectRatio: aspect, count: 1, captchaRetry: 1,
  } });
}
if (!work.length) return [{ json: { skip: true } }];
return work.map((w) => ({ json: w }));