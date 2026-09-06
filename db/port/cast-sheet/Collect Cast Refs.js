// Pair each generated sheet with the character it was made for, and hand the
// whole map on as ONE item.
//
// The HTTP node is onError: continueRegularOutput, so a refused or failed
// portrait arrives here as an item without media rather than as a dead batch —
// that character simply has no sheet and falls back to the n-1 chain, which is
// exactly today's behaviour. Order is 1:1 with Cast Sheet Prep's items.
const prep = $('Cast Sheet Prep').all();
const outs = $input.all();
const made = {};
const failed = [];
outs.forEach((it, i) => {
  const name = String((((prep[i] || {}).json) || {}).name || '');
  let id = '';
  try {
    id = String(((((it.json || {}).media || [])[0] || {}).image || {}).generatedImage?.mediaGenerationId || '');
  } catch (e) { id = ''; }
  if (name && id) made[name] = id;
  else if (name) failed.push(name);
});
for (const n of failed) console.log('CAST SHEET FAILED: ' + n + ' — this character falls back to the n-1 chain');
console.log('CAST SHEETS: ' + (Object.keys(made).join(', ') || 'none'));

// Merged with whatever the project already had, because `||` on jsonb replaces
// the whole castRefs key rather than merging into it.
let existing = {};
try {
  existing = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}').castRefs || {};
} catch (e) { existing = {}; }
return [{ json: { castRefs: Object.assign({}, existing, made), made: Object.keys(made).length } }];
