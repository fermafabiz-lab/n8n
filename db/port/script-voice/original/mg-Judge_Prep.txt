// The consistency judge — measured, not requested.
//
// Every rule above this node asks the image model for the same face, the
// same coat, the same building. This repo's hardest lesson is that an
// instruction in a prompt is not a constraint: if it matters, something
// AFTER the model has to say whether it happened. So the new frame is shown
// to a vision model next to the very sheets and plate it was anchored to,
// and the answer is a score, not a hope. Only what was actually attached is
// judged (no sheet, no judgement), and only through URLs that still resolve:
// a sheet's signed fifeUrl dies in hours, so on a later pass the judge may
// have nothing to compare against and says so instead of guessing.
const dec = $json; // Decode Scene Image: {sceneId, url, mediaId}
const req = $('Build Image Request').first().json;
const refs = Array.isArray(req.refs) ? req.refs : [];
const projF = ($('IMG Load Project').first().json.fields || {});
let opts = {}; try { opts = JSON.parse(projF['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }
try { if ($('Save Cast Refs').isExecuted) { const j = $('Save Cast Refs').first().json; if (j.cast_sheets) opts.castSheets = j.cast_sheets; } } catch (e) {}
try { if ($('Save Set Plates').isExecuted) { const j = $('Save Set Plates').first().json; if (j.location_plates) opts.locationPlates = j.location_plates; } } catch (e) {}
let bible = {}; try { bible = JSON.parse(projF['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
const descOf = (list, name) => String((((Array.isArray(list) ? list : []).find((x) => String((x || {}).name || '') === name)) || {}).visual_description || '');
const urlOf = (r) => {
  if (r.role === 'cast') return String(((opts.castSheets || {})[r.name] || {}).url || '');
  if (r.role === 'place') return String(((opts.locationPlates || {})[r.name] || {}).url || '');
  if (r.role === 'user') return String(opts.refImage || '');
  return '';
};
const stillValid = (u) => {
  const m = /[?&]Expires=(\d+)/.exec(u);
  return !!u && (!m || Number(m[1]) * 1000 > Date.now() + 60000);
};
const compare = refs.filter((r) => ['cast', 'place', 'user'].includes(r.role)).map((r) => ({ role: r.role, name: r.name, url: urlOf(r) })).filter((r) => stillValid(r.url));
if (!compare.length || !dec.url) {
  if (refs.some((r) => ['cast', 'place', 'user'].includes(r.role))) console.log('JUDGE skipped for ' + dec.sceneId + ': reference URLs expired or missing');
  return [{ json: Object.assign({}, dec, { skip: true }) }];
}
const lines = [];
const content = [{ type: 'text', text: 'FRAME — the newly generated film frame to judge:' }, { type: 'image_url', image_url: { url: dec.url, detail: 'low' } }];
compare.forEach((r, i) => {
  const label = r.role === 'place' ? 'PLACE reference ' + (i + 1) + ' — the location "' + r.name + '"' : (r.role === 'user' ? 'PERSON reference ' + (i + 1) + ' — the producer\'s photo of ' + r.name : 'PERSON reference ' + (i + 1) + ' — the character sheet of ' + r.name);
  const d = r.role === 'place' ? descOf(bible.locations, r.name) : descOf(bible.characters, r.name);
  content.push({ type: 'text', text: label + (d ? ' (described as: ' + d.slice(0, 400) + ')' : '') + ':' });
  content.push({ type: 'image_url', image_url: { url: r.url, detail: 'low' } });
  lines.push(label);
});
const hasPerson = compare.some((r) => r.role !== 'place'), hasPlace = compare.some((r) => r.role === 'place');
const ask = 'Judge whether the FRAME is consistent with the references. Score 0 to 1, where 1 is unmistakably the same and 0.5 is doubtful.' +
  (hasPerson ? ' "identity": does the character in the frame (a person, an animal or a creature) have the same face or head, hair or markings, colours, age and build as their reference (a different angle, distance or expression is fine)? "wardrobe": is it the same outfit — same garments, colours, materials? If the character is not visible in the frame at all (from behind at distance, hands only), answer 0.8 for both and say so in problems.' : '') +
  (hasPlace ? ' "place": is the frame the same location as the PLACE reference — same architecture, layout, landmarks, materials — allowing for a different framing, hour, weather and light?' : '') +
  ' Also check "sheet_leak": did the frame render the reference sheet itself (several copies of one character side by side, a neutral studio backdrop, a grid)? true/false. Answer ONLY JSON: {"identity": number|null, "wardrobe": number|null, "place": number|null, "sheet_leak": boolean, "problems": ["short concrete reason", ...]}';
content.push({ type: 'text', text: ask });
const body = { model: 'gpt-4o', temperature: 0, response_format: { type: 'json_object' }, messages: [
  { role: 'system', content: 'You are a film continuity supervisor comparing a generated frame with reference sheets. Be strict about faces or heads, hair or markings, colours, garments and architecture; be lenient about angle, distance, expression, pose, light and weather. Answer only the JSON object requested.' },
  { role: 'user', content: content },
] };
return [{ json: Object.assign({}, dec, { skip: false, body: body, compared: lines }) }];
