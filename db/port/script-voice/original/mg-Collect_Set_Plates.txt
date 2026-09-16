// Pair each plate with its location; failures fall back to text only.
const prep = $('Set Plate Prep').all();
const outs = $input.all();
const refs = {}, plates = {};
outs.forEach((it, i) => {
  const name = String((((prep[i] || {}).json) || {}).name || '');
  let gi = {};
  try { gi = ((((it.json || {}).media || [])[0] || {}).image || {}).generatedImage || {}; } catch (e) { gi = {}; }
  if (name && gi.mediaGenerationId) { refs[name] = String(gi.mediaGenerationId); plates[name] = { id: String(gi.mediaGenerationId), url: String(gi.fifeUrl || '') }; }
  else if (name) console.log('SET PLATE FAILED: ' + name + ' — scenes there fall back to text');
});
console.log('SET PLATES MADE: ' + (Object.keys(refs).join(', ') || 'none'));
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
const merge = (a, b) => Object.assign({}, (a && typeof a === 'object') ? a : {}, b);
return [{ json: { locationRefs: merge(opts.locationRefs, refs), locationPlates: merge(opts.locationPlates, plates), made: Object.keys(refs).length } }];
