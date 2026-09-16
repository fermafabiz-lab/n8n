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
