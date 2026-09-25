const item = $input.first().json;
function find(obj, pred) {
  let f = null;
  (function w(o) { if (f) return;
    if (typeof o === 'string') { if (pred(o)) f = o; return; }
    if (Array.isArray(o)) { for (const v of o) { if (f) return; w(v); } return; }
    if (o && typeof o === 'object') { for (const k of Object.keys(o)) { if (f) return; w(o[k]); } }
  })(obj);
  return f;
}
let url = null;
let mediaId = null;
try { const gv = item.response && item.response.media && item.response.media[0] && item.response.media[0].video && item.response.media[0].video.generatedVideo; if (gv) { if (typeof gv.fifeUrl === 'string') url = gv.fifeUrl; if (typeof gv.mediaGenerationId === 'string') mediaId = gv.mediaGenerationId; } } catch (e) {}
if (!url) url = find(item, s => s.startsWith('http') && s.includes('flow-content.google') && s.includes('/video'));
// The clip's own Flow identity, which POST /videos/upscale needs later. The
// main extractor has always pulled it; this one did not, so a regenerated
// clip would have been the one clip in a film that could never be upscaled.
if (!mediaId) mediaId = find(item, s => s.includes('-video:'));
if (!url) throw new Error('No video url in regen job. Head: ' + JSON.stringify(item).slice(0, 800));
return [{ json: { Video_Signed_URL: url, Video_Media_Id: mediaId || '' } }];