const fs = require('fs');
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v).sort().reduce((a, kk) => (a[kk] = v[kk], a), {}) : v);
const strip = (n) => { const { position, id, ...rest } = n; return rest; };
function diff(label, oldF, newF, expected) {
  const A = JSON.parse(fs.readFileSync(oldF)).workflow, B = JSON.parse(fs.readFileSync(newF)).workflow;
  console.log(`\n##### ${label}: versionId=${B.versionId} activeVersionId=${B.activeVersionId} draft_eq_live=${B.versionId === B.activeVersionId} nodes ${A.nodes.length} -> ${B.nodes.length} settings=${stable(B.settings)}`);
  const am = new Map(A.nodes.map(n => [n.name, n])), bm = new Map(B.nodes.map(n => [n.name, n]));
  const added = [...bm.keys()].filter(k => !am.has(k)), removed = [...am.keys()].filter(k => !bm.has(k));
  const changed = [...bm.keys()].filter(k => am.has(k) && stable(strip(am.get(k))) !== stable(strip(bm.get(k))));
  const moved = [...bm.keys()].filter(k => am.has(k) && !changed.includes(k) && stable(am.get(k).position) !== stable(bm.get(k).position));
  console.log('ADDED  :', added.join(' | '));
  console.log('REMOVED:', removed.join(' | '));
  console.log('CHANGED:', changed.join(' | '));
  console.log('MOVED only:', moved.join(' | '));
  const unexpected = [...added, ...removed, ...changed].filter(k => !expected.includes(k));
  console.log(unexpected.length ? '!!! UNEXPECTED DIFFS: ' + unexpected.join(' | ') : 'OK: every differing node is in the intended set');
  const missing = expected.filter(k => ![...added, ...removed, ...changed].includes(k));
  if (missing.length) console.log('!!! EXPECTED BUT UNCHANGED: ' + missing.join(' | '));
  // per changed node: which keys differ
  for (const k of changed) { const a = strip(am.get(k)), b = strip(bm.get(k)); const keys = new Set([...Object.keys(a), ...Object.keys(b)]); const d = [...keys].filter(x => stable(a[x]) !== stable(b[x])); console.log(`  ${k}: ${d.join(',')}`); }
  // edges
  const edges = (W) => { const s = new Set(); for (const [src, o] of Object.entries(W.connections)) (o.main || []).forEach((outs, i) => (outs || []).forEach(t => s.add(`${src} [${i}] -> ${t.node} [${t.index}]`))); return s; };
  const ea = edges(A), eb = edges(B);
  console.log('EDGES removed:'); [...ea].filter(e => !eb.has(e)).forEach(e => console.log('   - ' + e));
  console.log('EDGES added:'); [...eb].filter(e => !ea.has(e)).forEach(e => console.log('   + ' + e));
  // dangling by-name references to removed nodes
  const names = new Set(bm.keys());
  for (const n of B.nodes) { const s = JSON.stringify(n.parameters); const refs = [...s.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]); const bad = refs.filter(r => !names.has(r)); if (bad.length) console.log(`!!! ${n.name} references missing node(s): ${[...new Set(bad)].join(', ')}`); }
  // edge targets exist
  for (const e of eb) { const m = /^(.*) \[\d+\] -> (.*) \[\d+\]$/.exec(e); if (!names.has(m[1]) || !names.has(m[2])) console.log('!!! dangling edge ' + e); }
  // Drive nodes keep resource/operation
  for (const n of B.nodes) if (/googleDrive/.test(n.type)) console.log(`  drive: ${n.name} res=${n.parameters.resource || 'MISSING'} op=${n.parameters.operation || 'MISSING'}`);
  // credentials visible on new nodes?
  for (const k of added) console.log(`  new node ${k}: type=${bm.get(k).type} credentials=${JSON.stringify(bm.get(k).credentials)} onError=${bm.get(k).onError} retry=${bm.get(k).retryOnFail} webhookId=${bm.get(k).webhookId || '-'}`);
  // nodes still mentioning fal
  for (const n of B.nodes) if (/fal\.run|fal-ai|fal\.ai/i.test(JSON.stringify(n.parameters))) console.log(`  still mentions fal: ${n.name}`);
  return B;
}
const mgExpected = ['Build Image Request','Flow Pace','Generate Scene Image','Decode Scene Image','Write Scene Image','IMG Error Router','IMG Refusal?','IMG Cooldown Guard','Wait IMG Cooldown','IMG Retry Now?','Download Scene Image','User Ref?','Download User Ref','Save User Ref Id','Regenerate Scene Image','Decode Regen Image','Write Regen Image','Evaluate Image Approval','Download Regen Image','Upload Regen Asset To Flow','Extract Regen Asset Id','Sort & Cap Scenes','Prep Flow Reject','Submit Video','Submit Video Regen'];
const csExpected = ['IR Build Request','IR Generate Image','IR Decode Image','IR Write Image','IR Download Image','IR Upload To Flow'];
const mg = diff('MEDIA GENERATION', 'mg.draft.raw.json', 'mg.new.raw.json', mgExpected);
const cs = diff('CLAUDE SCRIPTING', 'cs.draft.raw.json', 'cs.new.raw.json', csExpected);
// verify the code landed byte-for-byte
const code = (n) => fs.readFileSync('nodes/' + n, 'utf8').replace(/\n$/, '');
const chk = (W, name, file) => console.log(`  ${name} jsCode == file: ${W.nodes.find(n => n.name === name).parameters.jsCode === code(file)}`);
chk(mg, 'Build Image Request', 'build_image_request.js'); chk(mg, 'Decode Scene Image', 'decode_scene_image.js'); chk(mg, 'IMG Error Router', 'img_error_router.js'); chk(mg, 'IMG Cooldown Guard', 'img_cooldown_guard.js'); chk(mg, 'Decode Regen Image', 'decode_regen_image.js');
chk(cs, 'IR Build Request', 'ir_build_request.js'); chk(cs, 'IR Decode Image', 'ir_decode_image.js');
const g = mg.nodes.find(n => n.name === 'Generate Scene Image'); console.log('  Generate Scene Image:', JSON.stringify({ p: g.parameters, onError: g.onError, retry: g.retryOnFail, cred: g.credentials }));
const r = mg.nodes.find(n => n.name === 'Regenerate Scene Image'); console.log('  Regenerate Scene Image:', JSON.stringify({ onError: r.onError, retry: r.retryOnFail, url: r.parameters.url, body: r.parameters.jsonBody.slice(0, 80) }));
const ir = cs.nodes.find(n => n.name === 'IR Generate Image'); console.log('  IR Generate Image:', JSON.stringify({ p: ir.parameters, onError: ir.onError, retry: ir.retryOnFail }));
