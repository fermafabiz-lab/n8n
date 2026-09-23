// Which Google Flow account generates THIS scene's image, decided per request.
//
// Assign Accounts puts each scene on its block's account at the start of the
// pass. That is right while every account answers — and wrong the moment Google
// flags one of them: on 2026-09-23 `houseofvideos01` answered 12 of 20 image
// requests with `403 PUBLIC_ERROR_UNUSUAL_ACTIVITY`, and every refusal cost the
// film a five-minute hold on that one account while the other two sat idle.
// Images are generated one at a time, so a flagged account stalls the whole
// image phase, not just its own block.
//
// So IMG Cooldown Guard now marks an account that Google flags as AVOIDED for
// 30 minutes (static data, `imgAvoid`), and this node routes the next request
// to the first account in use that is not avoided. The clip follows the image:
// Pool Tick and Submit Video take the video account from the owner encoded in
// the scene's Image Media ID, so a still made on another account never meets
// `Email mismatch`.
//
// Sits between Flow Pace and Generate Scene Image, on both the first attempt
// and every retry (IMG Retry Now? -> Flow Pace -> here).
const ACCOUNTS = [
  'fermafabiz@gmail.com',
  'houseofvideos01@gmail.com',
  'houseofvideos02@gmail.com',
];
const src = $('Build Image Request').first().json;
const sceneId = String(src.sceneId || '');

let block = '';
const inUse = [];
try {
  $('Assign Accounts').all().forEach(function (x) {
    const e = String((x.json && x.json.flowEmail) || '');
    if (e && inUse.indexOf(e) < 0) inUse.push(e);
    if (x.json && x.json.id === sceneId) block = e;
  });
} catch (e) {}
// Only the accounts this film actually runs on are candidates: they are the
// ones whose cast sheets and set plates were replicated (Assign Accounts' own
// coverage guard decided that), so a fallback there keeps its references.
inUse.sort(function (a, b) { return ACCOUNTS.indexOf(a) - ACCOUNTS.indexOf(b); });

const sd = $getWorkflowStaticData('global');
const avoid = sd.imgAvoid || {};
const now = Date.now();
const avoided = function (a) { return Number(avoid[a] || 0) > now; };

let acct = block;
if (block && avoided(block)) {
  const alt = inUse.find(function (a) { return a !== block && !avoided(a); });
  if (alt) {
    acct = alt;
    console.log('IMG ACCOUNT ' + sceneId + ': ' + block + ' is flagged by Google until ' + new Date(avoid[block]).toISOString().slice(11, 19) + ' UTC — generating on ' + alt + ' instead');
  }
}

return [{ json: { sceneId: sceneId, imgAccount: acct, blockAccount: block } }];
