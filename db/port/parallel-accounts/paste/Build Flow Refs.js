// Turn the per-upload results accumulated in static data into the one object
// that gets merged onto the project:
//
//   flowRefs['houseofvideos01@gmail.com'] = { '<primary id>': '<that account id>' }
//
// `Generate Scene Image` reads this to swap each reference id for the local one
// just before the request leaves, which is what keeps `Build Image Request`
// (12 kB) out of the change entirely.
//
// Keyed by execution id while it is being built, so two passes never read each
// other's half-finished table; flattened here, once, at the end.
const sd = $getWorkflowStaticData('global');
const ex = $execution.id;
const built = ((sd.flowRefs || {})[ex]) || {};

// Done with it — leaving it behind would grow static data by one entry per
// execution forever, and static data outlives the run.
if (sd.flowRefs) delete sd.flowRefs[ex];

const accounts = Object.keys(built);
let total = 0;
for (const a of accounts) total += Object.keys(built[a] || {}).length;

console.log('FLOW REFS: ' + accounts.length + ' account(s), ' + total + ' id(s) mapped');

// One item always, for the same reason Replicate Prep never returns none:
// `Find Audio Folder` is downstream. `Refs To Save?` reads `count`.
return [{ json: { flowRefs: built, count: total } }];
