const inputs = $('Split Regen List').all();
const resps = $input.all();
if (resps.length !== inputs.length) throw new Error('Regen response count (' + resps.length + ') != request count (' + inputs.length + ')');
return resps.map((r, i) => {
  // Flow answers synchronously — see Decode Scene Image for the shape.
  const m0 = (((r.json || {}).media || [])[0] || {});
  const gi = (m0.image && m0.image.generatedImage) || {};
  if (!gi.fifeUrl || !gi.mediaGenerationId) throw new Error('No image on regen (Google Flow) for scene ' + inputs[i].json.id + '. Payload head: ' + JSON.stringify(r.json).slice(0, 300));
  return { json: { sceneId: inputs[i].json.id, url: gi.fifeUrl, mediaId: gi.mediaGenerationId } };
});