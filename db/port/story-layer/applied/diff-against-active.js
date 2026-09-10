const fs = require('fs');
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v).sort().reduce((a, kk) => (a[kk] = v[kk], a), {}) : v);
const strip = (n) => { const { position, id, ...rest } = n; return rest; };
const A = JSON.parse(fs.readFileSync('cs.new.raw.json')).workflow, B = JSON.parse(fs.readFileSync('cs.story.raw.json')).workflow;
console.log(`versionId=${B.versionId} activeVersionId=${B.activeVersionId} draft_eq_live=${B.versionId===B.activeVersionId} nodes ${A.nodes.length} -> ${B.nodes.length}`);
const am = new Map(A.nodes.map(n => [n.name, n])), bm = new Map(B.nodes.map(n => [n.name, n]));
const added = [...bm.keys()].filter(k => !am.has(k)), removed = [...am.keys()].filter(k => !bm.has(k));
const changed = [...bm.keys()].filter(k => am.has(k) && stable(strip(am.get(k))) !== stable(strip(bm.get(k))));
const moved = [...bm.keys()].filter(k => am.has(k) && !changed.includes(k) && stable(am.get(k).position) !== stable(bm.get(k).position));
console.log('ADDED  :', added.join(' | ')); console.log('REMOVED:', removed.join(' | ')); console.log('CHANGED:', changed.join(' | ')); console.log('MOVED only:', moved.join(' | '));
const expected = ['Generate Story Bible','Generate Outline','Outline Parser','Generate Hook','Rewrite Script','Write Full Narration','Editor Model','Edit Full Narration','Narration Guard','If Narration Retry','Combine Chapters','Split Outline Chapters','Write Chapter Narration'];
const un = [...added, ...removed, ...changed].filter(k => !expected.includes(k)); console.log(un.length ? '!!! UNEXPECTED: ' + un.join(' | ') : 'OK: every differing node is in the intended set');
const miss = expected.filter(k => ![...added, ...removed, ...changed].includes(k)); if (miss.length) console.log('!!! EXPECTED BUT UNCHANGED: ' + miss.join(' | '));
for (const k of changed) { const a = strip(am.get(k)), b = strip(bm.get(k)); const keys = new Set([...Object.keys(a), ...Object.keys(b)]); console.log(`  ${k}: ${[...keys].filter(x => stable(a[x]) !== stable(b[x])).join(',')}`); }
const edges = (W) => { const s = new Set(); for (const [src, o] of Object.entries(W.connections)) for (const [type, arr] of Object.entries(o)) arr.forEach((outs, i) => (outs || []).forEach(t => s.add(`${src} [${type}${i}] -> ${t.node} [${t.index}]`))); return s; };
const ea = edges(A), eb = edges(B);
console.log('EDGES removed:'); [...ea].filter(e => !eb.has(e)).forEach(e => console.log('   - ' + e));
console.log('EDGES added:'); [...eb].filter(e => !ea.has(e)).forEach(e => console.log('   + ' + e));
const names = new Set(bm.keys());
for (const n of B.nodes) { const s = JSON.stringify(n.parameters); const bad = [...s.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]).filter(r => !names.has(r)); if (bad.length) console.log(`!!! ${n.name} references missing node(s): ${[...new Set(bad)].join(', ')}`); }
for (const e of eb) { const m = /^(.*) \[\w+\d+\] -> (.*) \[\d+\]$/.exec(e); if (!names.has(m[1]) || !names.has(m[2])) console.log('!!! dangling edge ' + e); }
for (const n of B.nodes) if (/googleDrive/.test(n.type)) console.log(`  drive: ${n.name} res=${n.parameters.resource || 'MISSING'} op=${n.parameters.operation || 'MISSING'}`);
// every agent has a model
for (const n of B.nodes) if (/langchain\.agent$/.test(n.type)) { const has = [...eb].some(e => e.includes('[ai_languageModel0] -> ' + n.name + ' [')); console.log(`  agent ${n.name}: model wired=${has}`); }
const f = (n) => fs.readFileSync('story/' + n, 'utf8').replace(/\n$/, '');
const chk = (name, file, key) => console.log(`  ${name}.${key} == file: ${bm.get(name).parameters[key] === f(file)}`);
chk('Generate Outline', 'outline.prompt.txt', 'text'); chk('Write Full Narration', 'write.prompt.txt', 'text'); chk('Edit Full Narration', 'edit.prompt.txt', 'text'); chk('Narration Guard', 'guard.js', 'jsCode'); chk('Combine Chapters', 'combine.js', 'jsCode');
console.log('  Outline Parser schema:', bm.get('Outline Parser').parameters.jsonSchemaExample.slice(0, 120));
