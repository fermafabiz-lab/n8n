// Which Google Flow account generates each scene.
//
// The film is cut into CONTIGUOUS blocks, one per account. Contiguous rather
// than round-robin because a scene's image and its clip cannot live on
// different accounts: useapi refuses the pair outright —
//   400 Email mismatch: body has 'X', references have 'Y'
// — and the account is hex-encoded inside every mediaGenerationId. Keeping a
// block contiguous also keeps the n-1 palette reference on the same account for
// every scene but the first of each block; those start like scene 1 of any
// film, on the cast sheets and set plates alone.
//
// OFF BY DEFAULT and it ships that way. `Editing Options.flowAccounts` must be
// 2 or 3 for anything to change; at 1 every scene gets the primary account and
// this node is a no-op.
const ACCOUNTS = [
  'fermafabiz@gmail.com',
  'houseofvideos01@gmail.com',
  'houseofvideos02@gmail.com',
];

let opts = {};
try {
  opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {};
} catch (e) { opts = {}; }

// Refuse-then-clamp, like every other Editing Options number: anything that is
// not an integer in 1..ACCOUNTS.length falls back to 1 rather than being
// coerced into range, and says so.
let n = 1;
const raw = opts.flowAccounts;
if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= ACCOUNTS.length) {
  n = raw;
} else if (raw !== undefined) {
  console.log('FLOW ACCOUNTS: refusing flowAccounts=' + JSON.stringify(raw) + ', using 1');
}

// THE GUARD THAT MAKES THIS SAFE TO SHIP AHEAD OF ITS OTHER HALF.
// castRefs / objectRefs / locationRefs / refImageMediaId are Flow media ids,
// and a media id belongs to the account that minted it. They are all made on
// the primary account today. Splitting scenes across accounts before those
// sheets are replicated per account would send primary-account reference ids
// with a different `email` — every scene outside block 0 would fail on Email
// mismatch. So until that exists, a project that HAS such references stays on
// one account no matter what the flag says.
const hasAccountScopedRefs = !!(
  (opts.castRefs && Object.keys(opts.castRefs).length) ||
  (opts.objectRefs && Object.keys(opts.objectRefs).length) ||
  (opts.locationRefs && Object.keys(opts.locationRefs).length) ||
  opts.refImageMediaId
);
if (n > 1 && hasAccountScopedRefs) {
  console.log('FLOW ACCOUNTS: project carries account-scoped references (cast/object/location/user ref) — staying on one account until they are replicated per account');
  n = 1;
}

const items = $input.all();
const total = items.length;
const per = Math.max(1, Math.ceil(total / n));

const out = items.map((it, i) => {
  const block = n > 1 ? Math.min(n - 1, Math.floor(i / per)) : 0;
  return { json: Object.assign({}, it.json, { flowEmail: ACCOUNTS[block], flowBlock: block }) };
});

const counts = {};
out.forEach((o) => { counts[o.json.flowEmail] = (counts[o.json.flowEmail] || 0) + 1; });
console.log('FLOW ACCOUNTS: n=' + n + ' of ' + ACCOUNTS.length + ', ' + total + ' scenes — ' + JSON.stringify(counts));

return out;
