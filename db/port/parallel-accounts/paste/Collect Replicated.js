// Accumulate one account's copy of a reference image, keyed by the id the
// PRIMARY account knows it as. The result is a translation table:
//
//   flowRefs['houseofvideos01@gmail.com'][<primary id>] = <that account's id>
//
// which is what lets `Generate Scene Image` keep using whatever
// `Build Image Request` decided the references should be — that node is 12 kB
// and is deliberately not touched — and simply swap each id for the local one
// just before the request goes out.
//
// Static data rather than run data because this loop runs once per upload and
// the totals have to survive across iterations. Keyed by execution id, the same
// way `sd.imgCooldowns` is, so two passes never read each other's half-built
// tables.
const sd = $getWorkflowStaticData('global');
const ex = $execution.id;
sd.flowRefs = sd.flowRefs || {};
sd.flowRefs[ex] = sd.flowRefs[ex] || {};

const w = $('Loop Replicate').first().json || {};
const account = String(w.account || '');
const primaryId = String(w.primaryId || '');

let newId = '';
const item = $json || {};
const rawId = item.mediaGenerationId;
if (typeof rawId === 'string') newId = rawId;
else if (rawId && typeof rawId.mediaGenerationId === 'string') newId = rawId.mediaGenerationId;

if (account && primaryId && newId) {
  sd.flowRefs[ex][account] = sd.flowRefs[ex][account] || {};
  sd.flowRefs[ex][account][primaryId] = newId;
  console.log('REPLICATED ' + w.key + ' -> ' + account);
} else {
  // A refusal here is not fatal: the scenes on that account fall back to the
  // text prompt and the n-1 chain, exactly as they do when a sheet fails to
  // generate in the first place. But `Assign Accounts` must then refuse to use
  // that account, so the gap is recorded rather than swallowed.
  console.log('REPLICATE FAILED ' + (w.key || '?') + ' -> ' + (account || '?') + ': ' + JSON.stringify(item).slice(0, 300));
}

return [{ json: { account: account, key: w.key, primaryId: primaryId, newId: newId } }];
