const fs = require('fs');
const mg = JSON.parse(fs.readFileSync('mg.raw.json')).workflow;
const cs = JSON.parse(fs.readFileSync('cs.raw.json')).workflow;
const N = (w, n) => { const x = w.nodes.find(y => y.name === n); if (!x) throw new Error('missing ' + n); return x; };
const rd = (f) => fs.readFileSync(f, 'utf8').replace(/\n$/, '');
const must = (s, a, b, label) => { if (!s.includes(a)) throw new Error('pattern not found in ' + label + ': ' + a.slice(0, 80)); return s.split(a).join(b); };
const AUTH = { parameters: [{ name: 'Authorization', value: 'Bearer user:2923-RNCS1SSSMj5DqvdN7JUMo' }, { name: 'Content-Type', value: 'application/json' }] };
const boolIf = (id, expr) => ({ conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 }, conditions: [{ id, leftValue: '={{ ' + expr + ' }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} });
const PG = { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } };
const assembler = rd('assembler.js');

// ---------------- Media Generation
let sortCap = N(mg, 'Sort & Cap Scenes').parameters.jsCode;
sortCap = must(sortCap, "sd.imgCooldowns = {};\n", "sd.imgCooldowns = {};\nsd.consistencyRerolls = {};\nsd.consistencyNotes = {};\n", 'Sort & Cap');
let evalCode = N(mg, 'Evaluate Image Approval').parameters.jsCode;
const evStart = evalCode.indexOf('const regen = [];'), evEnd = evalCode.indexOf('const total = recs.length;');
if (evStart < 0 || evEnd < 0) throw new Error('eval block markers');
evalCode = assembler + '\n' + evalCode.slice(0, evStart) + rd('eval_regen_block.js') + '\n' + evalCode.slice(evEnd);
new Function('$', '$input', '$getWorkflowStaticData', 'console', evalCode);

const genHttp = (name, pos) => ({ type: 'addNode', node: { name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: pos, onError: 'continueRegularOutput', alwaysOutputData: true, parameters: { method: 'POST', url: 'https://api.useapi.net/v1/google-flow/images', sendHeaders: true, headerParameters: AUTH, sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.requestBody }}', options: { timeout: 180000, batching: { batch: { batchSize: 1, batchInterval: 8000 } } } } } });

const opsMG = [
  // --- who appears how often, before the sheets are planned
  { type: 'addNode', node: { name: 'Load Scene Cast', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-1560, 400], executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput', parameters: { operation: 'executeQuery', query: rd('load_scene_cast.sql'), options: {} }, credentials: PG } },
  { type: 'updateNodeParameters', nodeName: 'Cast Sheet Prep', parameters: { jsCode: rd('cast_sheet_prep.js') } },
  { type: 'updateNodeParameters', nodeName: 'Collect Cast Refs', parameters: { jsCode: rd('collect_cast_refs.js') } },
  { type: 'updateNodeParameters', nodeName: 'Save Cast Refs', parameters: { query: rd('save_cast_refs.sql') } },
  // --- set plates
  { type: 'addNode', node: { name: 'Set Plate Prep', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1360, -80], parameters: { jsCode: rd('set_plate_prep.js') } } },
  { type: 'addNode', node: { name: 'Set Plate?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [-1200, -80], parameters: boolIf('set-plate-has-work', '!$json.skip') } },
  genHttp('Generate Set Plate', [-1040, -160]),
  { type: 'addNode', node: { name: 'Collect Set Plates', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-880, -160], parameters: { jsCode: rd('collect_set_plates.js') } } },
  { type: 'addNode', node: { name: 'Save Set Plates', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-720, -160], onError: 'continueRegularOutput', parameters: { operation: 'executeQuery', query: rd('save_set_plates.sql'), options: {} }, credentials: PG } },
  // --- the generators
  { type: 'updateNodeParameters', nodeName: 'Build Image Request', parameters: { jsCode: rd('build_image_request.js') } },
  { type: 'updateNodeParameters', nodeName: 'Evaluate Image Approval', parameters: { jsCode: evalCode } },
  { type: 'updateNodeParameters', nodeName: 'Regenerate Scene Image', parameters: { jsonBody: rd('regen_jsonbody.txt') } },
  { type: 'updateNodeParameters', nodeName: 'Sort & Cap Scenes', parameters: { jsCode: sortCap } },
  // --- the judge
  { type: 'addNode', node: { name: 'Judge Prep', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-384, -40], parameters: { jsCode: rd('judge_prep.js') } } },
  { type: 'addNode', node: { name: 'Judge?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [-224, -40], parameters: boolIf('judge-has-refs', '!$json.skip') } },
  { type: 'addNode', node: { name: 'Consistency Judge', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [-64, -120], onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, parameters: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi', sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.body }}', options: { timeout: 90000 } }, credentials: { openAiApi: { id: 'oPGuXelJ6pnDePIs', name: 'OpenAI account' } } } },
  { type: 'addNode', node: { name: 'Judge Verdict', type: 'n8n-nodes-base.code', typeVersion: 2, position: [96, -40], parameters: { jsCode: rd('judge_verdict.js') } } },
  { type: 'addNode', node: { name: 'If Reroll?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [256, -40], parameters: boolIf('consistency-reroll', '$json.reroll === true') } },
  { type: 'addNode', node: { name: 'CONS Reload Scene', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [256, -200], parameters: { operation: 'executeQuery', query: rd('cons_reload_scene.sql'), options: {} }, credentials: PG } },
  { type: 'setNodePosition', nodeName: 'Write Scene Image', position: [416, 120] },
  // --- rewiring: user photo first, then sheets, then plates, then the batch
  { type: 'removeConnection', source: 'IMG Load Project', target: 'Cast Sheet Prep' },
  { type: 'removeConnection', source: 'Cast Sheet?', sourceIndex: 1, target: 'User Ref?' },
  { type: 'removeConnection', source: 'Save Cast Refs', target: 'User Ref?' },
  { type: 'removeConnection', source: 'User Ref?', sourceIndex: 1, target: 'Find Audio Folder' },
  { type: 'removeConnection', source: 'Upload Asset To Flow', sourceIndex: 1, target: 'Find Audio Folder' },
  { type: 'removeConnection', source: 'Save User Ref Id', target: 'Find Audio Folder' },
  { type: 'removeConnection', source: 'Decode Scene Image', target: 'Write Scene Image' },
  { type: 'addConnection', source: 'IMG Load Project', target: 'User Ref?' },
  { type: 'addConnection', source: 'User Ref?', sourceIndex: 1, target: 'Load Scene Cast' },
  { type: 'addConnection', source: 'Upload Asset To Flow', sourceIndex: 1, target: 'Load Scene Cast' },
  { type: 'addConnection', source: 'Save User Ref Id', target: 'Load Scene Cast' },
  { type: 'addConnection', source: 'Load Scene Cast', target: 'Cast Sheet Prep' },
  { type: 'addConnection', source: 'Cast Sheet?', sourceIndex: 1, target: 'Set Plate Prep' },
  { type: 'addConnection', source: 'Save Cast Refs', target: 'Set Plate Prep' },
  { type: 'addConnection', source: 'Set Plate Prep', target: 'Set Plate?' },
  { type: 'addConnection', source: 'Set Plate?', sourceIndex: 0, target: 'Generate Set Plate' },
  { type: 'addConnection', source: 'Set Plate?', sourceIndex: 1, target: 'Find Audio Folder' },
  { type: 'addConnection', source: 'Generate Set Plate', target: 'Collect Set Plates' },
  { type: 'addConnection', source: 'Collect Set Plates', target: 'Save Set Plates' },
  { type: 'addConnection', source: 'Save Set Plates', target: 'Find Audio Folder' },
  { type: 'addConnection', source: 'Decode Scene Image', target: 'Judge Prep' },
  { type: 'addConnection', source: 'Judge Prep', target: 'Judge?' },
  { type: 'addConnection', source: 'Judge?', sourceIndex: 0, target: 'Consistency Judge' },
  { type: 'addConnection', source: 'Judge?', sourceIndex: 1, target: 'Judge Verdict' },
  { type: 'addConnection', source: 'Consistency Judge', target: 'Judge Verdict' },
  { type: 'addConnection', source: 'Judge Verdict', target: 'If Reroll?' },
  { type: 'addConnection', source: 'If Reroll?', sourceIndex: 0, target: 'CONS Reload Scene' },
  { type: 'addConnection', source: 'If Reroll?', sourceIndex: 1, target: 'Write Scene Image' },
  { type: 'addConnection', source: 'CONS Reload Scene', target: 'Needs Image?' },
];

// ---------------- Claude Scripting
const bibleSchema = JSON.stringify({ logline: 'string', characters: [{ name: 'string', role: 'string', visual_description: 'string' }], objects: [{ name: 'string', visual_description: 'string' }], locations: [{ name: 'string', visual_description: 'string' }], era_setting: 'string', visual_style: { palette: 'string', lighting: 'string', camera: 'string', film_look: 'string' }, motifs: ['string'], continuity_rules: ['string'] });
const patchBible = (text, label) => {
  let t = must(text, '\n\nReturn ONLY raw JSON', '\n6. objects: the HERO OBJECTS of this film — a vehicle, a machine, a weapon, a signature prop — that recur across scenes and must look identical every time (0-3; an empty list is fine). Each with a name and a visual_description as exact as a character\'s: make, model or type, colour, materials, markings, damage, distinguishing details. A car that changes model between shots is the same failure as a face that changes.\n\nReturn ONLY raw JSON', label);
  t = must(t, 'Never write "as before" or "same as".', 'Never write "as before" or "same as". For every LOCATION also fix its GEOMETRY, because a wide establishing plate is drawn from this text and every scene there is anchored to it: what stands at the centre, on the left, on the right and in the background; the size and shape of the space; the materials, colours and two or three landmarks that identify this exact place from any angle.', label);
  return t;
};
const segSchema = JSON.stringify({ scenes: [{ chapter_number: 1, chapter_title: 'string', scene_number: 1, scene_duration_seconds: 8, narrator_text: 'string', visual_scene_description: 'string', image_prompt: 'string', video_motion_prompt: 'string', location: 'string', characters: ['string'], objects: ['string'], time_of_day: 'string', evidence_required: false, evidence_ref: 'E1' }] });
let seg = N(cs, 'Segment Chapter Into Scenes').parameters.text;
seg = must(seg, "{{ $('Voice Mode').first().json.segmentRules }}", "7. CONTINUITY FIELDS — these four fields are read by CODE, never by a model, and they are how the image pipeline attaches each scene's reference sheets and set plate, so fill them with the bible's EXACT names, spelled exactly as the bible spells them: location = the one bible location this scene is set in (\"\" only if it is genuinely nowhere in the bible); characters = every bible character visible in the frame, as a list of their exact bible names (empty list if nobody is visible); objects = every bible object visible in the frame, exact names; time_of_day = one word: dawn, morning, day, afternoon, dusk, night, or interior. A name that is not in the bible is a failure.\n{{ $('Voice Mode').first().json.segmentRules }}", 'segment');
seg = must(seg, 'Each scene object: chapter_number (use the number above), chapter_title, scene_number (sequential from 1), scene_duration_seconds: 8, narrator_text, visual_scene_description, image_prompt, video_motion_prompt, evidence_required, evidence_ref.', 'Each scene object: chapter_number (use the number above), chapter_title, scene_number (sequential from 1), scene_duration_seconds: 8, narrator_text, visual_scene_description, image_prompt, video_motion_prompt, location, characters, objects, time_of_day, evidence_required, evidence_ref.', 'segment');
let save = N(cs, 'Save scenes To Airtable1').parameters.query;
save = must(save, '"Needs Fact Check": $json.needs_fact_check === true })', '"Needs Fact Check": $json.needs_fact_check === true, "Tag-uri Scenă": (() => { const t = []; if ($json.location) t.push(\'loc:\' + String($json.location).trim()); (Array.isArray($json.characters) ? $json.characters : []).forEach((c) => { if (c) t.push(\'char:\' + String(c).trim()); }); (Array.isArray($json.objects) ? $json.objects : []).forEach((o) => { if (o) t.push(\'obj:\' + String(o).trim()); }); if ($json.time_of_day) t.push(\'tod:\' + String($json.time_of_day).trim().toLowerCase()); return t; })() })', 'save scenes');
let validate = N(cs, 'Validate Evidence Refs').parameters.jsCode;
validate = must(validate, 'return items;', `// Continuity fields come from the model too: a location or character name
// that is not in the bible would attach no sheet and no plate, and the image
// pipeline must be able to trust a tag it finds. Keep only exact bible names
// (case- and diacritic-insensitive), drop the rest.
try {
  const bible = ($('Choose Bible').first().json || {}).bible || {};
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/\\p{M}/gu, '').toLowerCase().trim();
  const canon = (list) => { const m = {}; (Array.isArray(list) ? list : []).forEach((e) => { const n = String((e || {}).name || '').trim(); if (n) m[norm(n)] = n; }); return m; };
  const chars = canon(bible.characters), objs = canon(bible.objects), locs = canon(bible.locations);
  const pick = (m, v) => m[norm(v)] || '';
  for (const item of items) {
    const j = item.json;
    j.location = pick(locs, j.location);
    j.characters = [...new Set((Array.isArray(j.characters) ? j.characters : []).map((c) => pick(chars, c)).filter(Boolean))];
    j.objects = [...new Set((Array.isArray(j.objects) ? j.objects : []).map((o) => pick(objs, o)).filter(Boolean))];
    j.time_of_day = /^(dawn|morning|day|afternoon|dusk|night|interior)$/i.test(String(j.time_of_day || '')) ? String(j.time_of_day).toLowerCase() : '';
  }
} catch (e) { console.log('continuity tags: bible unreadable, tags dropped — ' + e.message); for (const item of items) { item.json.location = ''; item.json.characters = []; item.json.objects = []; item.json.time_of_day = ''; } }
return items;`, 'validate');
new Function('$', '$input', 'console', validate);

const opsCS = [
  { type: 'updateNodeParameters', nodeName: 'Story Bible Parser', parameters: { jsonSchemaExample: bibleSchema } },
  { type: 'updateNodeParameters', nodeName: 'Generate Story Bible', parameters: { text: patchBible(N(cs, 'Generate Story Bible').parameters.text, 'Generate Story Bible') } },
  { type: 'updateNodeParameters', nodeName: 'Rebuild Story Bible', parameters: { text: patchBible(N(cs, 'Rebuild Story Bible').parameters.text, 'Rebuild Story Bible') } },
  { type: 'updateNodeParameters', nodeName: 'Segment Parser', parameters: { jsonSchemaExample: segSchema } },
  { type: 'updateNodeParameters', nodeName: 'Segment Chapter Into Scenes', parameters: { text: seg } },
  { type: 'updateNodeParameters', nodeName: 'Validate Evidence Refs', parameters: { jsCode: validate } },
  { type: 'updateNodeParameters', nodeName: 'Save scenes To Airtable1', parameters: { query: save } },
  { type: 'updateNodeParameters', nodeName: 'IR Build Request', parameters: { jsCode: rd('ir_build_request.js') } },
];
fs.writeFileSync('opsMG.json', JSON.stringify(opsMG));
fs.writeFileSync('opsCS.json', JSON.stringify(opsCS));
console.log('MG ops', opsMG.length, fs.statSync('opsMG.json').size, 'CS ops', opsCS.length, fs.statSync('opsCS.json').size);
