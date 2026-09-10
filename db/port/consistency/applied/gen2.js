const fs = require('fs');
const mg = JSON.parse(fs.readFileSync('mg.raw.json')).workflow;
const N = (w, n) => { const x = w.nodes.find(y => y.name === n); if (!x) throw new Error('missing ' + n); return x; };
const rd = (f) => fs.readFileSync(f, 'utf8').replace(/\n$/, '');
const assembler = rd('assembler.js');
let evalCode = N(mg, 'Evaluate Image Approval').parameters.jsCode;
const evStart = evalCode.indexOf('const regen = [];'), evEnd = evalCode.indexOf('const total = recs.length;');
if (evStart < 0 || evEnd < 0) throw new Error('eval block markers');
evalCode = assembler + '\n' + evalCode.slice(0, evStart) + rd('eval_regen_block.js') + '\n' + evalCode.slice(evEnd);
for (const [f, code] of [['bir', rd('build_image_request.js')], ['ir', rd('ir_build_request.js')], ['csp', rd('cast_sheet_prep.js')], ['jp', rd('judge_prep.js')], ['eval', evalCode]]) {
  new Function('$', '$input', '$getWorkflowStaticData', 'console', '$json', '$runIndex', code); // syntax check
}
const opsMG = [
  { type: 'updateNodeParameters', nodeName: 'Cast Sheet Prep', parameters: { jsCode: rd('cast_sheet_prep.js') } },
  { type: 'updateNodeParameters', nodeName: 'Build Image Request', parameters: { jsCode: rd('build_image_request.js') } },
  { type: 'updateNodeParameters', nodeName: 'Evaluate Image Approval', parameters: { jsCode: evalCode } },
  { type: 'updateNodeParameters', nodeName: 'Judge Prep', parameters: { jsCode: rd('judge_prep.js') } },
];
const opsCS = [{ type: 'updateNodeParameters', nodeName: 'IR Build Request', parameters: { jsCode: rd('ir_build_request.js') } }];
fs.writeFileSync('ops2MG.json', JSON.stringify(opsMG));
fs.writeFileSync('ops2CS.json', JSON.stringify(opsCS));
// also refresh the full op lists so the repo record matches what is live
const all = JSON.parse(fs.readFileSync('opsMG.json'));
for (const o of opsMG) { const t = all.find(x => (x.nodeName === o.nodeName && x.type === 'updateNodeParameters') || (x.type === 'addNode' && x.node.name === o.nodeName)); if (!t) throw new Error('no op for ' + o.nodeName); if (t.type === 'addNode') t.node.parameters.jsCode = o.parameters.jsCode; else t.parameters.jsCode = o.parameters.jsCode; }
fs.writeFileSync('opsMG.json', JSON.stringify(all));
const allCS = JSON.parse(fs.readFileSync('opsCS.json'));
allCS.find(x => x.nodeName === 'IR Build Request').parameters.jsCode = opsCS[0].parameters.jsCode;
fs.writeFileSync('opsCS.json', JSON.stringify(allCS));
console.log('ops2MG', fs.statSync('ops2MG.json').size, 'ops2CS', fs.statSync('ops2CS.json').size);
