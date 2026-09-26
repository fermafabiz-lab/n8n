// Fold the result of a steal tick back into the pool, then hand control to
// Pool Tick. The input is `Steal Upload`'s response — or, since all three
// steal nodes carry onError: continueRegularOutput, an error envelope from
// whichever of them failed.
//
// A copy that did not land is not retried: the scene is marked `noSteal` and
// stays on its own account, which is exactly where it was before the tick.
// Nothing here can make a film worse than it was without stealing.
let pool = null;
let tick = {};
try { tick = $('Pool Tick').first().json || {}; pool = tick.pool || null; } catch (e) { pool = null; }
if (!pool) throw new Error('Steal Record: no pool state on Pool Tick — this node is only reachable from a steal tick.');

const id = String(tick.poolSceneId || '');
const to = String(tick.poolTo || '');
const from = String(tick.poolFrom || '');

// The uploaded copy's id, in the two shapes useapi has answered with.
const item = $json || {};
let newId = '';
const raw = item.mediaGenerationId;
if (typeof raw === 'string') newId = raw;
else if (raw && typeof raw.mediaGenerationId === 'string') newId = raw.mediaGenerationId;

// PRESENCE IS NOT CORRECTNESS: the account is hex between `-email:` and
// `-image:`, and an id filed under the wrong account is what killed execution
// 14618. Decode and check before believing the upload went where it was sent.
let owner = '';
const hx = newId.match(/-email:([0-9a-f]+)-/i);
if (hx) { for (let i = 0; i < hx[1].length; i += 2) owner += String.fromCharCode(parseInt(hx[1].substr(i, 2), 16)); }
if (newId && owner !== to) {
  console.log('POOL steal ' + id + ': the copy landed on ' + (owner || '?') + ', not ' + to + ' — not using it');
  newId = '';
}

pool.stolen = pool.stolen || {};
const q = (pool.queue || []).find(function (x) { return x.id === id; });
if (newId && q) {
  pool.stolen[id] = { image: newId, account: to, from: from, original: String(tick.poolImageId || '') };
  q.account = to;
  console.log('POOL steal ' + id + ': still copied to ' + to + ' as ' + newId.slice(-12) + ' — the clip will be made there');
} else {
  if (q) q.noSteal = true;
  console.log('POOL steal ' + id + ': copy failed (' + String((item.error && (item.error.message || item.error)) || 'no mediaGenerationId in the response').slice(0, 160) + ') — leaving it on ' + (from || '(primary)'));
}

return [{ json: { pool: pool } }];
