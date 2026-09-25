// Read the end frame out of the Flow response and hand the payload on — and
// never throw. Mirrors `Attach End Frame` on the batch path.
//
// The payload is re-emitted whole because `Submit Video Regen` reads `$json`.
// `endImage` rides along on it AND is read back by the submit through
// $('RG Attach End Frame') with a scene-id guard, which is what makes it
// survive the two guards that loop back into the submit: both of them
// re-feed `Prep Video Regen`'s payload, which has no end frame on it.
const p = (() => { try { return $('RG End Frame Prompt').first().json || {}; } catch (e) { return {}; } })();

let endImage = '';
let why = '';
try {
  const resp = $json || {};
  if (resp.error) {
    why = String(resp.error.message || resp.error.description || resp.error).slice(0, 200);
  } else {
    const gi = (((resp.media || [])[0] || {}).image || {}).generatedImage || {};
    endImage = gi.mediaGenerationId || '';
    if (!endImage) why = 'no mediaGenerationId in response: ' + JSON.stringify(resp).slice(0, 200);
  }
} catch (e) {
  why = 'unreadable response: ' + String(e && e.message || e).slice(0, 200);
}

if (endImage) console.log('RG ENDFRAME ' + p.id + ': got ' + endImage);
else console.log('RG ENDFRAME ' + p.id + ': none, falling back to start frame only — ' + why);

return [{ json: Object.assign({}, p, { sceneId: p.id, endImage: endImage, efError: why }) }];
