// 'Sort & Cap Scenes' runs at most CAP (8) scenes per pass, so a project
// with more approved scenes than that needs several passes. The batch used
// to walk straight from the last approved clip to the final-settings gate,
// which left the tail ungenerated AND kept the execution alive — hiding the
// site's own "Start the next batch" button, whose whole condition is that
// nothing is running. The producer's only way through was Pause + Resume.
//
// So the batch asks for itself: any approved scene still without a clip —
// or owed a video regeneration — means another pass is owed. Same rule as
// `pending` in Sort & Cap Scenes; keep the two together.
const recs = $input.all();
const remaining = recs.filter((r) => {
  const f = r.json.fields || {};
  return !String(f['Scene Final URL'] || '').startsWith('http') || f['Regenerează Video'] === true;
}).length;
// 12 passes = 96 scenes, far past anything real. A scene that can never
// finish (permanent content refusal) must not spin the loop forever — it
// falls through to the gate and the producer sees it unfinished.
const MAX_PASSES = 12;
const more = remaining > 0 && $runIndex + 1 < MAX_PASSES;
if (remaining > 0 && !more) console.log('Batch loop: giving up after ' + ($runIndex + 1) + ' passes with ' + remaining + ' scene(s) still unfinished.');
else console.log('Batch pass ' + ($runIndex + 1) + ' done; ' + remaining + ' scene(s) still to generate.');
return [{ json: { remaining, more, pass: $runIndex + 1 } }];