// Put the narration back on `$json` after the report was written.
//
// A Postgres node outputs its QUERY RESULT, not its input — `FC Save Report`
// hands on `{project_id: 'rec…'}` and nothing else. `Combine Chapters` reads
// `$json.chapters`, so without this node the chapters would arrive undefined
// and the run would die one step later with "No chapters to combine", at a
// point that says nothing about the real cause.
//
// This is the same trick and the same reason as `Evidence Done`, which
// collapses the Save Evidence batches back to the Extract Claims payload so
// the Story Bible prompt keeps reading `$json.output`. When a writer has to
// sit between two nodes that speak to each other through `$json`, it is
// followed by a node that restores the conversation.
//
// TWO DOORS SINCE THE TOP-UP (2026-09-23). When `FC Fill Apply` ran, IT holds
// the narration as it now stands and `FC Apply` holds the one before the
// sentences were added — so reading `FC Apply` unconditionally, as this node
// used to, would silently throw the top-up away. A node that never ran throws
// when referenced, which is what the try is for.
//
// `fill` is stripped: it carried the pack and the whole narration to the
// top-up, and nothing past this point has any use for either.
let x = null;
try {
  x = $('FC Fill Apply').first().json;
} catch (e) {
  x = null;
}
if (!x || !Array.isArray(x.chapters)) x = $('FC Apply').first().json;
const { fill, ...rest } = x || {};
return [{ json: rest }];
