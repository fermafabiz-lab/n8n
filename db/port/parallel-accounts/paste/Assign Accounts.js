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

// THE GUARD. castRefs / objectRefs / locationRefs / refImageMediaId are Flow
// media ids, and a media id belongs to the account that minted it. A block
// running on another account can only use them once they have been copied
// there and recorded in `flowRefs` by the replication chain (Replicate Prep ->
// Save Flow Refs). Until that exists for an account, sending its scenes would
// fail every one of them on `Email mismatch`, so the film stays on however many
// accounts ARE fully covered.
const scoped = [];
for (const k of ['castRefs', 'objectRefs', 'locationRefs']) {
  const o = opts[k];
  if (o && typeof o === 'object') for (const name of Object.keys(o)) if (o[name]) scoped.push(String(o[name]));
}
if (opts.refImageMediaId) scoped.push(String(opts.refImageMediaId));

// Fresh table from this pass first, stored table second — on the pass that
// creates them, `IMG Load Project` was read before `Save Flow Refs` wrote.
let flowRefs = {};
if (opts.flowRefs && typeof opts.flowRefs === 'object') {
  for (const a of Object.keys(opts.flowRefs)) flowRefs[a] = Object.assign({}, opts.flowRefs[a]);
}
try {
  const fresh = ($('Build Flow Refs').first().json || {}).flowRefs || {};
  for (const a of Object.keys(fresh)) flowRefs[a] = Object.assign({}, flowRefs[a] || {}, fresh[a]);
} catch (e) {}

if (n > 1 && scoped.length) {
  let allowed = 1;
  for (let k = 1; k < n; k++) {
    const acct = ACCOUNTS[k];
    const have = flowRefs[acct] || {};
    // Presence is NOT correctness. The first real run wrote a table whose
    // account-01 entry held five ids all minted on account 02; a presence-only
    // check passed it, and every scene in that block would then have died on
    // `Email mismatch`. So each mapped id is decoded — the account is hex
    // between `-email:` and `-image:` — and counted as missing unless it really
    // belongs to the account it is filed under.
    const missing = scoped.filter(function (id) {
      const v = have[id];
      if (!v) return true;
      let owner = '';
      const hx = String(v).match(/-email:([0-9a-f]+)-/i);
      if (hx) { for (let i = 0; i < hx[1].length; i += 2) owner += String.fromCharCode(parseInt(hx[1].substr(i, 2), 16)); }
      return owner !== acct;
    });
    if (missing.length) {
      console.log('FLOW ACCOUNTS: ' + acct + ' is missing ' + missing.length + ' of ' + scoped.length + ' reference image(s), so it is not used');
      break;
    }
    allowed = k + 1;
  }
  if (allowed < n) console.log('FLOW ACCOUNTS: asked for ' + n + ', using ' + allowed);
  n = allowed;
}

const items = $input.all();
const total = items.length;
const per = Math.max(1, Math.ceil(total / n));

// THE IMAGE IS THE ANCHOR, not the position.
//
// A clip is generated FROM the scene's start frame, and useapi refuses the pair
// when the body's email and the reference's owner disagree:
//   400 Email mismatch: body has 'X', references have 'Y'
// Position alone cannot decide that, because the list this node receives is not
// the same list between passes — `Sort & Cap Scenes` puts scenes that already
// have a clip at the BACK, so on a second pass over a partly-finished film every
// block boundary moves and scenes keep their old image while being handed a new
// account. That is not hypothetical: it killed execution 14618 after two good
// clips, with the image on account 02 and the body addressed to 01.
//
// So a scene that ALREADY has an image stays on whatever account minted it, and
// position decides only for scenes that have none yet. This costs nothing in
// balance — a scene with an image no longer needs image generation, which is the
// only phase the block split exists to spread — and it makes the assignment
// stable across passes instead of drifting with the sort.
const ownerOf = function (id) {
  let owner = '';
  const hx = String(id || '').match(/-email:([0-9a-f]+)-/i);
  if (hx) { for (let i = 0; i < hx[1].length; i += 2) owner += String.fromCharCode(parseInt(hx[1].substr(i, 2), 16)); }
  return owner.indexOf('@') < 0 ? '' : owner;
};

let anchored = 0;
const out = items.map((it, i) => {
  const block = n > 1 ? Math.min(n - 1, Math.floor(i / per)) : 0;
  let email = ACCOUNTS[block];
  const imgOwner = ownerOf(((it.json.fields || {})['Image Media ID']) || '');
  if (imgOwner && imgOwner !== email) {
    anchored++;
    email = imgOwner;
  }
  return { json: Object.assign({}, it.json, { flowEmail: email, flowBlock: block }) };
});
if (anchored) {
  console.log('FLOW ACCOUNTS: ' + anchored + ' scene(s) kept on the account that minted their image rather than on their block');
}

const counts = {};
out.forEach((o) => { counts[o.json.flowEmail] = (counts[o.json.flowEmail] || 0) + 1; });
console.log('FLOW ACCOUNTS: n=' + n + ' of ' + ACCOUNTS.length + ', ' + total + ' scenes — ' + JSON.stringify(counts));

return out;
