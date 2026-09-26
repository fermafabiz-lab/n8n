const item = $json;
let id = '';
const raw = item.mediaGenerationId;
if (typeof raw === 'string') id = raw;
else if (raw && typeof raw.mediaGenerationId === 'string') id = raw.mediaGenerationId;
if (!id) {
  (function walk(o) {
    if (id) return;
    if (typeof o === 'string') { if (o.includes('-image:') || o.includes('-asset:')) id = o; return; }
    if (Array.isArray(o)) { for (const v of o) { if (id) return; walk(v); } return; }
    if (o && typeof o === 'object') { for (const k of Object.keys(o)) { if (id) return; walk(o[k]); } }
  })(item);
}
if (!id || typeof id !== 'string') throw new Error('No mediaGenerationId string found in Flow asset upload response: ' + JSON.stringify(item).slice(0, 500));
return [{ json: { mediaId: id } }];