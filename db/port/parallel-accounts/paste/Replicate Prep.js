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
// The bytes come from OUR OWN store, via hov.sheet_media, not from Flow's
// `fifeUrl` — that one is a signed URL which dies within hours, so sourcing it
// would have limited replication to the single pass that drew the sheet. The
// sheet ingest chain (Sheet Ingest Prep -> Ingest Sheets, and the plate pair)
// keeps a durable copy keyed by the Flow id, which is what makes this work on
// any pass, including one that generates no sheets at all.
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

// NEVER return an empty list. A node that emits nothing stops every node
// downstream of it, and `Find Audio Folder` — the whole rest of the batch —
// hangs off this chain. The empty case emits one `skip` item instead, and
// `Replicate Any?` routes it straight past the loop.
if (n <= 1) {
  console.log('REPLICATE: flowAccounts=' + n + ', nothing to copy');
  return [{ json: { skip: true } }];
}

const targets = ACCOUNTS.slice(1, n);

// Every stored sheet for this project, keyed by the Flow id the PRIMARY account
// knows it as. A row with no usable url is skipped rather than guessed at.
const sources = [];
const seen = {};
for (const row of $input.all()) {
  const j = row.json || {};
  const flowId = String(j.flow_id || '');
  const url = String(j.url || '');
  if (!flowId || !url || seen[flowId]) continue;
  seen[flowId] = true;
  sources.push({ key: String(j.kind || 'sheet') + ':' + String(j.name || '?'), primaryId: flowId, url: url });
}

// The producer's own photo never went through sheet_media — it arrives as a
// durable Drive URL on the project and is uploaded straight to Flow — so it is
// added from Editing Options instead.
if (opts.refImage && opts.refImageMediaId && !seen[String(opts.refImageMediaId)]) {
  sources.push({ key: 'user', primaryId: String(opts.refImageMediaId), url: String(opts.refImage) });
}

// Already-copied images are skipped, so a second pass does not upload the same
// sheet again and mint a duplicate asset on the account. What is stored on the
// project is the record; the fresh table from this pass does not exist yet here.
const stored = (opts.flowRefs && typeof opts.flowRefs === 'object') ? opts.flowRefs : {};

const work = [];
for (const acct of targets) {
  const have = stored[acct] || {};
  for (const s of sources) {
    if (have[s.primaryId]) continue;
    work.push({ skip: false, account: acct, key: s.key, primaryId: s.primaryId, url: s.url });
  }
}

console.log('REPLICATE: ' + sources.length + ' reference image(s) x ' + targets.length + ' account(s) = ' + work.length + ' upload(s)');
if (!work.length) {
  console.log('REPLICATE: this film has no stored reference images, so every account can draw it from the prompt alone');
  return [{ json: { skip: true } }];
}

return work.map(function (w) { return { json: w }; });
