// Accumulate one account's copy of a reference image, keyed by the id the
// PRIMARY account knows it as. The result is a translation table:
//
//   flowRefs['houseofvideos01@gmail.com'][<primary id>] = <that account's id>
//
// which is what lets `Generate Scene Image` keep using whatever
// `Build Image Request` decided the references should be — that node is 12 kB
// and is deliberately not touched — and simply swap each id for the local one
// just before the request goes out.
const sd = $getWorkflowStaticData('global');
const ex = $execution.id;
sd.flowRefs = sd.flowRefs || {};
sd.flowRefs[ex] = sd.flowRefs[ex] || {};

// THIS iteration's work item, by position. It used to read
// `$('Loop Replicate').first()`, and on the first real run (film
// rec1rkfxvBeMCFDRj) that filed FIVE of account 01's uploads under the wrong
// account — 0 of 5 belonged to it, while account 02 was 6 of 6, an inversion
// that only an off-by-one produces. `.first()` is a node's LATEST run, which is
// not the same thing as the current loop item. `$runIndex` counts THIS node's
// own runs, which is exactly the index into the ordered work list.
const work = $('Replicate Prep').all();
const w = ((work[$runIndex] || {}).json) || {};
const intended = String(w.account || '');
const primaryId = String(w.primaryId || '');

let newId = '';
const item = $json || {};
const rawId = item.mediaGenerationId;
if (typeof rawId === 'string') newId = rawId;
else if (rawId && typeof rawId.mediaGenerationId === 'string') newId = rawId.mediaGenerationId;

// The account is taken from the id Flow ACTUALLY returned, not from the one we
// asked for. The account is hex-encoded between `-email:` and `-image:`, so the
// id itself is the authority on where the copy landed. Filing it anywhere else
// is precisely what produced the broken table, and a table that lies here fails
// every scene in that block on `Email mismatch` much later.
let owner = '';
const h = newId.match(/-email:([0-9a-f]+)-/i);
if (h) { for (let i = 0; i < h[1].length; i += 2) owner += String.fromCharCode(parseInt(h[1].substr(i, 2), 16)); }
if (owner.indexOf('@') < 0) owner = '';

if (owner && intended && owner !== intended) {
  console.log('REPLICATE MISROUTED ' + (w.key || '?') + ': asked for ' + intended + ', Flow answered an id on ' + owner + ' — filing it under ' + owner);
}

const account = owner || intended;

if (account && primaryId && newId) {
  sd.flowRefs[ex][account] = sd.flowRefs[ex][account] || {};
  sd.flowRefs[ex][account][primaryId] = newId;
  console.log('REPLICATED ' + w.key + ' -> ' + account);
} else {
  // Not fatal: the scenes on that account fall back to the text prompt and the
  // n-1 chain, exactly as they do when a sheet fails to generate at all. But
  // `Assign Accounts` must then refuse to use that account, so the gap is
  // recorded rather than swallowed.
  console.log('REPLICATE FAILED ' + (w.key || '?') + ' -> ' + (intended || '?') + ': ' + JSON.stringify(item).slice(0, 300));
}

return [{ json: { account: account, intended: intended, key: w.key, primaryId: primaryId, newId: newId } }];
