// The bytes have to reach the session that commits them, and this session has
// no outbound HTTP at all — so they ride back inside the execution's runData as
// base64. `bytes` is what the landing script checks the decoded length against,
// which is what catches a truncated payload rather than committing a corrupt
// image.
const item = $input.first();
const bin = (item.binary || {}).data;
if (!bin || !bin.data) throw new Error('SITE ART: the fetch returned no binary data');

const b64 = bin.data;
const bytes = Buffer.from(b64, 'base64').length;
console.log('SITE ART: ' + bytes + ' bytes, mime ' + (bin.mimeType || '?'));

return [{ json: { b64, bytes, mimeType: bin.mimeType || '', mediaId: $('Site Art Collect').first().json.mediaId } }];
