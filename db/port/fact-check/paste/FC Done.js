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
return [{ json: $('FC Apply').first().json }];
