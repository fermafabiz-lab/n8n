const inputs = $('Split Regen List').all();
const resps = $input.all();
if (resps.length !== inputs.length) throw new Error('Regen response count (' + resps.length + ') != request count (' + inputs.length + ')');
return resps.map((r, i) => {
  // Flow answers synchronously — see Decode Scene Image for the shape.
  const m0 = (((r.json || {}).media || [])[0] || {});
  const gi = (m0.image && m0.image.generatedImage) || {};
  // Same silent refusal as Decode Scene Image (2026-09-17): a completed job
  // with no image in it. Unguarded, this throw killed the whole execution —
  // including the video gate, which is the only thing that can clear another
  // scene's Regenerează Video. The node now carries onError:
  // continueErrorOutput into Mark Image Regen Rejected, the same place this
  // branch's HTTP failures already go, so the film survives one refused
  // regeneration and the scene is handed back to the producer with a reason.
  if (!gi.fifeUrl || !gi.mediaGenerationId) throw new Error('FLOW_NO_IMAGE — Google Flow returned no image on regen for scene ' + inputs[i].json.id + '. Payload head: ' + JSON.stringify(r.json).slice(0, 300));
  return { json: { sceneId: inputs[i].json.id, url: gi.fifeUrl, mediaId: gi.mediaGenerationId } };
});