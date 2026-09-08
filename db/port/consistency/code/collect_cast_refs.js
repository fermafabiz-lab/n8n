// Pair each generated sheet with what it was made for, and hand the maps on
// as ONE item. The HTTP node is onError: continueRegularOutput, so a refused
// or failed sheet arrives here as an item without media — that name simply
// has no sheet and falls back to text + the n-1 chain. Order is 1:1 with
// Cast Sheet Prep's items.
//
// Two maps per kind: `castRefs` {name: id} is what the generators attach;
// `castSheets` {name: {id, url, kind}} carries the signed fifeUrl the
// Consistency Judge looks at (it expires in hours — the judge skips a sheet
// it can no longer fetch) and the tier, so an upgrade from portrait to
// turnaround can be recognised on a later pass.
const prep = $('Cast Sheet Prep').all();
const outs = $input.all();
const cast = {}, sheets = {}, objects = {}, failed = [];
outs.forEach((it, i) => {
  const p = ((prep[i] || {}).json) || {};
  const name = String(p.name || '');
  let gi = {};
  try { gi = ((((it.json || {}).media || [])[0] || {}).image || {}).generatedImage || {}; } catch (e) { gi = {}; }
  const id = String(gi.mediaGenerationId || ''), url = String(gi.fifeUrl || '');
  if (!name || !id) { if (name) failed.push(name); return; }
  if (p.kind === 'object') objects[name] = id;
  else { cast[name] = id; sheets[name] = { id: id, url: url, kind: p.sheet || 'portrait' }; }
});
for (const n of failed) console.log('SHEET FAILED: ' + n + ' — falls back to text and the n-1 chain');
console.log('SHEETS MADE: cast ' + (Object.keys(cast).join(', ') || 'none') + '; objects ' + (Object.keys(objects).join(', ') || 'none'));
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
const merge = (a, b) => Object.assign({}, (a && typeof a === 'object') ? a : {}, b);
return [{ json: {
  castRefs: merge(opts.castRefs, cast),
  castSheets: merge(opts.castSheets, sheets),
  objectRefs: merge(opts.objectRefs, objects),
  made: Object.keys(cast).length + Object.keys(objects).length,
} }];
