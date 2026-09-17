// Build the work list for copying this film's account-scoped reference images
// onto the other Flow accounts.
//
// Why this has to exist: castRefs / objectRefs / locationRefs / refImageMediaId
// are Flow media ids, and a media id belongs to the account that minted it —
// the account is hex-encoded inside the id itself. A scene generated on account
// B cannot pass a reference minted on A; useapi refuses the pair outright with
// "Email mismatch: body has X, references have Y". So every account that will
// draw scenes needs its own copy of the same pictures, and the only way to get
// one is to upload the bytes again (proved possible: POST /assets/{email}
// accepted a Flow-born image, execution 14274).
//
// THE CONSTRAINT THAT SHAPES THIS NODE: the only address we hold for a sheet is
// its `fifeUrl`, a signed Google URL that dies within hours. It is alive only
// during the pass that generated the sheet. So replication happens HERE, right
// after the sheets are made, or not at all. A film whose sheets were made on an
// earlier pass cannot be split across accounts, and `Assign Accounts` keeps it
// on one — which is the honest behaviour, not a bug.
//
// The producer's own reference photo is the exception: `Editing Options.refImage`
// is a durable Drive URL, so it can be replicated on any pass.
const ACCOUNTS = [
  'fermafabiz@gmail.com',
  'houseofvideos01@gmail.com',
  'houseofvideos02@gmail.com',
];

let opts = {};
try {
  opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {};
} catch (e) { opts = {}; }

let n = 1;
const raw = opts.flowAccounts;
if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= ACCOUNTS.length) n = raw;

// Nothing to replicate onto when the film stays on one account.
if (n <= 1) {
  console.log('REPLICATE: flowAccounts=' + n + ', nothing to copy');
  return [];
}

const targets = ACCOUNTS.slice(1, n);

// Freshly made sheets carry a live fifeUrl; anything only in `opts` is from an
// earlier pass and its URL is dead, so it is deliberately not offered here.
const sources = [];
try {
  const c = $('Collect Cast Refs').first().json || {};
  const sheets = c.castSheets || {};
  for (const name of Object.keys(sheets)) {
    const s = sheets[name] || {};
    if (s.id && s.url) sources.push({ key: 'cast:' + name, primaryId: String(s.id), url: String(s.url) });
  }
} catch (e) {}
try {
  const p = $('Collect Set Plates').first().json || {};
  const plates = p.locationPlates || {};
  for (const name of Object.keys(plates)) {
    const s = plates[name] || {};
    if (s.id && s.url) sources.push({ key: 'place:' + name, primaryId: String(s.id), url: String(s.url) });
  }
} catch (e) {}
if (opts.refImage && opts.refImageMediaId) {
  sources.push({ key: 'user', primaryId: String(opts.refImageMediaId), url: String(opts.refImage) });
}

const work = [];
for (const acct of targets) {
  for (const s of sources) {
    work.push({ account: acct, key: s.key, primaryId: s.primaryId, url: s.url });
  }
}

console.log('REPLICATE: ' + sources.length + ' reference image(s) x ' + targets.length + ' account(s) = ' + work.length + ' upload(s)');
if (!work.length) console.log('REPLICATE: nothing replicable this pass — any sheets this film has were made earlier and their fifeUrl is dead');

return work.map(function (w) { return { json: w }; });
