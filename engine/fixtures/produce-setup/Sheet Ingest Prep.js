// Our own copy of every sheet made in THIS pass, taken now, while Flow's
// signed URL is alive: it dies within hours (the judge already skips a sheet
// it can no longer fetch), and a series page can only show a face we kept.
// The site's /api/media/ingest stores the bytes under the project and keys
// them by the Flow id, so a sheet reused across episodes is one picture.
//
// Paired with Cast Sheet Prep's items by index, exactly as Collect Cast Refs
// does; a refused or failed sheet has no media and is simply not kept.
// ONE item out, always — the rest of the batch follows this node.
const prep = $('Cast Sheet Prep').all();
const outs = $('Generate Cast Sheet').all();
const projectId = String($('Receive Batch Input').first().json.Project_ID || '');
const items = [];
outs.forEach((it, i) => {
  const p = ((prep[i] || {}).json) || {};
  const name = String(p.name || '');
  let gi = {};
  try { gi = ((((it.json || {}).media || [])[0] || {}).image || {}).generatedImage || {}; } catch (e) { gi = {}; }
  const id = String(gi.mediaGenerationId || ''), url = String(gi.fifeUrl || '');
  if (!name || !id || !/^https?:\/\//.test(url)) return;
  items.push({ kind: p.kind === 'object' ? 'object' : 'cast', name: name, flowId: id, url: url });
});
console.log('SHEET INGEST: ' + (items.length ? items.map((x) => x.kind + ':' + x.name).join(', ') : 'nothing to keep'));
if (!items.length || !/^rec[A-Za-z0-9]{14}$/.test(projectId)) return [{ json: { skip: true } }];
return [{ json: { skip: false, projectId: projectId, items: items } }];
