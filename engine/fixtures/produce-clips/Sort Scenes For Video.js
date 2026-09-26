const expected = $('Sort & Cap Scenes').all().map(s => s.json.id);
const order = {};
expected.forEach((id, i) => order[id] = i);
const seen = new Set();
const recs = $input.all()
  .filter(r => order[r.json.id] !== undefined)
  .filter(r => { if (seen.has(r.json.id)) return false; seen.add(r.json.id); return true; })
  .slice()
  .sort((a, b) => order[a.json.id] - order[b.json.id]);
const missing = recs.filter(r => { const a = (r.json.fields || {})['Imagine Scenă']; return !(Array.isArray(a) && a[0] && a[0].url); });
if (missing.length) throw new Error('Scenes missing approved image: ' + missing.map(r => r.json.id).join(', '));
return recs;