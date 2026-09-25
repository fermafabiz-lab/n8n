// Flow answers synchronously: media[0].image.generatedImage carries the
// signed fifeUrl (IR Write Image's ingest downloads and re-hosts it) and
// the mediaGenerationId Submit Video uses as startImage.
const resp = $json;
const m0 = ((resp.media || [])[0] || {});
const gi = (m0.image && m0.image.generatedImage) || {};
if (!gi.fifeUrl || !gi.mediaGenerationId) throw new Error('No image in Flow response. Head: ' + JSON.stringify(resp).slice(0, 400));
return [{ json: { sceneId: $('IR Build Request').first().json.sceneId, url: gi.fifeUrl, mediaId: gi.mediaGenerationId } }];