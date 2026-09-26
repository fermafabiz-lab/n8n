// The set plates made in THIS pass, kept the same way as the cast sheets
// (see Sheet Ingest Prep): paired with Set Plate Prep's items by index like
// Collect Set Plates does, skipped when there is no media, ONE item out.
const prep = $('Set Plate Prep').all();
const outs = $('Generate Set Plate').all();
const projectId = String($('Receive Batch Input').first().json.Project_ID || '');
const items = [];
outs.forEach((it, i) => {
  const name = String((((prep[i] || {}).json) || {}).name || '');
  let gi = {};
  try { gi = ((((it.json || {}).media || [])[0] || {}).image || {}).generatedImage || {}; } catch (e) { gi = {}; }
  const id = String(gi.mediaGenerationId || ''), url = String(gi.fifeUrl || '');
  if (!name || !id || !/^https?:\/\//.test(url)) return;
  items.push({ kind: 'location', name: name, flowId: id, url: url });
});
console.log('PLATE INGEST: ' + (items.length ? items.map((x) => x.name).join(', ') : 'nothing to keep'));
if (!items.length || !/^rec[A-Za-z0-9]{14}$/.test(projectId)) return [{ json: { skip: true } }];
return [{ json: { skip: false, projectId: projectId, items: items } }];
