// Flow answers synchronously: media[0].image.generatedImage carries the
// signed fifeUrl (expires — Write Scene Image's ingest downloads it on the
// spot and re-hosts the bytes) and the mediaGenerationId that Submit Video
// uses as startImage. Same shape Extract Video URL reads for clips.
const resp = $json;
const m0 = ((resp.media || [])[0] || {});
const gi = (m0.image && m0.image.generatedImage) || {};
const url = gi.fifeUrl || '';
const mediaId = gi.mediaGenerationId || '';
if (!url || !mediaId) throw new Error('No image in Flow response. Head: ' + JSON.stringify(resp).slice(0, 400));
const sceneId = $('Build Image Request').first().json.sceneId;
return [{ json: { sceneId: sceneId, url: url, mediaId: mediaId } }];