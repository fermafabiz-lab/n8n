// Motif cards chosen by Claude Scripting and validated THERE, where the whole
// story was known and a quote could still be checked against its scene. This
// is a lookup: nothing is re-judged on the render path.
const body = $json.body;

let opts = {};
try {
  opts = JSON.parse(($('Fetch Project Info').first().json.fields || {})['Editing Options'] || '{}') || {};
} catch (e) { opts = {}; }
const cards = Array.isArray(opts.motifCards) ? opts.motifCards : [];

if (cards.length) {
  // Ordine Scenă per scene id, from the node that still has both.
  const orderById = new Map();
  try {
    for (const it of $('Fetch Approved Scenes').all()) {
      const f = it.json.fields || {};
      if (it.json.id != null) orderById.set(it.json.id, f['Ordine Scenă']);
    }
  } catch (e) {}
  // The rendered scene list, in its own order, expressed as those numbers.
  const rendered = $('Prepare Clips').all().map((c) => orderById.get(c.json.id));

  const out = [];
  for (const card of cards) {
    const i = (card.sceneOrder !== undefined && card.sceneOrder !== null)
      ? rendered.indexOf(card.sceneOrder)
      : card.sceneIndex;
    // A card whose scene never got a clip is left out. Not a failure to
    // report: the scene is not in the film either.
    if (!(i >= 0 && i < (body.scenes || []).length)) continue;
    const spec = Object.assign({}, card);
    // Bookkeeping for the producer's panel, not for the renderer.
    delete spec.sceneOrder;
    delete spec.verdict;
    delete spec.why;
    spec.sceneIndex = i;
    out.push(spec);
  }
  // Only when there is one: an empty array still counts as "explicit cards"
  // downstream and would switch the derived ones off for nothing.
  if (out.length) body.textCards = out;
}

return [{ json: { body } }];