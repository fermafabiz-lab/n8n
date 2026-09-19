// What the viewer is actually looking at, per scene: AI GENERATED, ARCHIVAL
// FOOTAGE, ACTUAL FOOTAGE, SOURCE UNVERIFIED.
//
// A LOOKUP and nothing else. The classification is made once on the site
// (platform/lib/provenance.ts), stored on the scene (db/009) and emitted by
// hov.at_scene as one `Provenance` object already in the render's own shape.
// Nothing is decided here, and that is the point: a render path that
// re-derived provenance could disagree with the record the producer approved,
// on the one overlay whose whole job is telling the truth about the picture.
//
// Its OWN node beside Caption Colour and Attach Motif Cards, for the same
// reason those are: Build Remotion Props is large and actively edited, and
// this needs nothing from it but the body it already produced.
const body = $json.body;

let opts = {};
try {
  opts = JSON.parse(($('Fetch Project Info').first().json.fields || {})['Editing Options'] || '{}') || {};
} catch (e) { opts = {}; }

// On unless refused, like every other overlay - and the absence matters more
// here than elsewhere: a film that says nothing about where its pictures came
// from reads as a claim that they are real.
//
// The switch owns the LABEL only. A credit a licence REQUIRES is drawn
// whatever it says, and the render decides that from the provenance itself.
body.showSourceWatermark = opts.sourceWatermark !== false;

// Announce each kind of source ONCE: the first archival band opens into the
// full pill, every later one stays the small glyph. Strictly `=== true`,
// matching normalizeEditing on the site — a missing key must never quieten a
// film's provenance labels by itself, and absence is what every film made
// before this switch existed has.
//
// Like the switch above it, this owns the LABEL only. A licence credit is
// drawn under a collapsed chip exactly as under an open pill.
body.watermarkOpenOnce = opts.watermarkOpenOnce === true;

// Provenance per scene, matched on the scene ID rather than on position:
// Prepare Clips DROPS every scene with no final clip, so the index the
// database row sits at and the index the render draws part company the moment
// one clip is missing. Same anchor rule as Attach Motif Cards.
const byId = new Map();
try {
  for (const it of $('Fetch Approved Scenes').all()) {
    const p = (it.json.fields || {})['Provenance'];
    if (it.json.id != null && p) byId.set(it.json.id, p);
  }
} catch (e) {}

const clips = $('Prepare Clips').all();
let labelled = 0;
(body.scenes || []).forEach((s, i) => {
  const clip = clips[i];
  const p = clip ? byId.get(clip.json.id) : null;
  // Absent means db/009 has not been applied yet, or the row predates it. The
  // render draws nothing for a scene with no provenance, which is the right
  // direction for a label about truthfulness: silence rather than a guess.
  if (p) { s.provenance = p; labelled++; }
});
console.log('provenance on ' + labelled + '/' + (body.scenes || []).length + ' scenes, watermark ' + (body.showSourceWatermark ? 'on' : 'off') + (body.watermarkOpenOnce ? ', announced once per source' : ''));

return [{ json: { body } }];
