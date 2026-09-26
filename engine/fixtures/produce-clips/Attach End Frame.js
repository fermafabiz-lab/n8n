// Read the end frame out of the Flow response — and never, ever throw.
//
// This node is scaffolding on the happy path of the whole batch. If it fails
// the scene must still get its clip the way it did before end frames existed,
// so every failure here returns an EMPTY endImage rather than an error:
// `Generate End Frame` carries onError: continueRegularOutput for the same
// reason, which means $json may well be an error envelope rather than a Flow
// response.
//
// Same response shape `Decode Scene Image` reads:
//   media[0].image.generatedImage.{ fifeUrl, mediaGenerationId }
// Only the id matters here — the picture is never stored, re-hosted or shown.
const efp = (() => { try { return $('End Frame Prompt').first().json || {}; } catch (e) { return {}; } })();
const sceneId = efp.sceneId || '';

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

// sceneId travels with it because `Submit Video` is reached by four edges and
// reads this node with .first(), which returns a node's LATEST run rather than
// the run belonging to the item in hand. On a scene that skipped the end frame
// that latest run is the PREVIOUS scene's — so Submit Video attaches the id
// only when the scene ids match, and this is the half that makes that possible.
if (endImage) console.log('ENDFRAME ' + sceneId + ': got ' + endImage);
else console.log('ENDFRAME ' + sceneId + ': none, falling back to start frame only — ' + why);

return [{ json: { sceneId: sceneId, endImage: endImage, reason: why } }];
