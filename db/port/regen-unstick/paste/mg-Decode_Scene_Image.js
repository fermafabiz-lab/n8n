// Flow answers synchronously: media[0].image.generatedImage carries the
// signed fifeUrl (expires — Write Scene Image's ingest downloads it on the
// spot and re-hosts the bytes) and the mediaGenerationId that Submit Video
// uses as startImage. Same shape Extract Video URL reads for clips.
const resp = $json;
const m0 = ((resp.media || [])[0] || {});
const gi = (m0.image && m0.image.generatedImage) || {};
const url = gi.fifeUrl || '';
const mediaId = gi.mediaGenerationId || '';
// A SILENT REFUSAL, and the reason this node has an error output (2026-09-17).
//
// Flow refuses a prompt in two different ways. The loud one is an HTTP error,
// which 'Generate Scene Image' routes down its error output into IMG Error
// Router -> the rewrite ladder. The quiet one is an HTTP 200 whose
// generatedImage carries the prompt and the seed and nothing else: the job
// ran, the filter ate the picture, and the response says so only by the
// absence of a URL. The HTTP node calls that success, so the ladder never
// saw it and this throw was uncaught — it killed the WHOLE execution, taking
// the image gate and the video gate of every other scene with it. Measured
// 2026-09-17: executions 14202, 14208 and two more died here on one scene's
// character-sheet reference, and the two clips the producer had asked to
// regenerate were never reached, so their Regenerează Video flag could never
// be cleared by anyone. That is what "regenerate does nothing, forever" was.
//
// Still a throw, because it IS a failure — but the node now carries
// onError: continueErrorOutput and its second output goes to IMG Error
// Router, so a silent refusal walks the same rewrite ladder as a loud one.
// The marker is what makes the classification deterministic: without it the
// router would fall through to its "everything else" branch and retry the
// byte-identical prompt twenty times, which is the one thing that cannot
// work — the filter's verdict does not change on a re-ask.
if (!url || !mediaId) throw new Error('FLOW_NO_IMAGE — Google Flow completed the job and returned no image, which is how its content filter refuses quietly. Head: ' + JSON.stringify(resp).slice(0, 400));
const sceneId = $('Build Image Request').first().json.sceneId;
return [{ json: { sceneId: sceneId, url: url, mediaId: mediaId } }];