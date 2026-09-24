// Diagnostic harness (draft only): route a metadata or compose request
// through the existing fal-credentialed nodes.
const b = $json.body || {};
if (b.mode === 'compose') return [{ json: { body: b.compose } }];
return [{ json: { url: b.media_url } }];