// The pool brain. ONE TICK = ONE action on ONE scene.
//
// Why this shape rather than a general K-at-a-time rewrite: eleven nodes
// downstream read $('Current Scene').first(), which is that node's LATEST run.
// With several clips in flight that would be ambiguous — unless every one of
// them runs inside the same tick that set the scene. So the pool never
// interleaves work WITHIN a tick: it picks one scene, Current Scene is re-run
// for it, one thing happens, and control comes back here. The large bodies
// (End Frame Prompt 13.6k chars, Motion Resubmit 12.7k, Motion Prep 9.7k,
// Motion Verdict 9.2k) therefore need no change at all, which matters because
// a web session cannot transcribe them — see db/port/parallel-accounts/etapa3.md.
//
// The concurrency is at GOOGLE, not here. Submit Video sends async:true and
// gets a jobid in about a second; what used to block was Wait Video → Poll,
// minutes per scene, one scene at a time.
//
// State travels in the emitted ITEM, never in $getWorkflowStaticData — static
// data is WORKFLOW-scoped, so two films at once would share it. Pool Record
// reads it back with $('Pool Tick').first(), unambiguous for the same reason
// everything else here is: one tick at a time.

const POLL_EVERY_MS = 20000; // comfortably under the 65s n8n suspension threshold
const MAX_POLLS = 90; // ~30 min of polling before a clip is given up on

let pool = ($json && $json.pool) || null;

// ---------------------------------------------------------------------------
// First entry: the input is the whole batch of scene rows from Sort Scenes For
// Video. Every later entry arrives from Pool Record (or Steal Record) carrying
// the state.
// ---------------------------------------------------------------------------
if (!pool) {
  let opts = {};
  try {
    opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {};
  } catch (e) { opts = {}; }

  // Refuse-then-clamp, the house rule for every Editing Options field.
  let per = 1;
  const rawPer = opts.videoPoolPerAccount;
  if (typeof rawPer === 'number' && Number.isInteger(rawPer) && rawPer >= 1 && rawPer <= 4) {
    per = rawPer;
  } else if (rawPer !== undefined) {
    console.log('POOL: ignoring videoPoolPerAccount=' + JSON.stringify(rawPer) + ', using 1');
  }

  // Which account each scene was assigned by Assign Accounts. A scene with no
  // entry falls back to '', which groups it with the primary — the same account
  // Submit Video would have used anyway.
  const acct = {};
  try {
    $('Assign Accounts').all().forEach(function (x) {
      if (x.json && x.json.id) acct[x.json.id] = String(x.json.flowEmail || '');
    });
  } catch (e) {}

  const queue = [];
  $input.all().forEach(function (r) {
    const id = r.json && r.json.id;
    if (!id) return;
    const f = r.json.fields || {};
    // Already has a clip. Needs Clip? would reach the same conclusion one node
    // later; skipping here just saves a tick.
    if (String(f['Scene Final URL'] || '') !== '') return;
    // THE CLIP FOLLOWS THE IMAGE (2026-09-23). A still may have been made on
    // another account than its block's when IMG Account routed around a
    // flagged one, and useapi refuses a clip whose body email differs from its
    // start image's owner. So the queue takes the owner encoded in the Image
    // Media ID, and falls back to Assign Accounts only for a scene with none.
    let owner = '';
    const hx = String(f['Image Media ID'] || '').match(/-email:([0-9a-f]+)-/i);
    if (hx) { for (let k = 0; k < hx[1].length; k += 2) owner += String.fromCharCode(parseInt(hx[1].substr(k, 2), 16)); }
    if (owner.indexOf('@') < 0) owner = '';
    queue.push({ id: String(id), account: owner || acct[id] || '' });
  });

  const byAcct = {};
  queue.forEach(function (q) { byAcct[q.account || '(primary)'] = (byAcct[q.account || '(primary)'] || 0) + 1; });
  console.log('POOL: ' + queue.length + ' scene(s) to generate, ' + per + ' job(s) per account, split ' + JSON.stringify(byAcct));

  // The accounts this film runs on, for work stealing below. With one account
  // the list has one entry and stealing never fires.
  const accounts = [];
  queue.forEach(function (q) { if (accounts.indexOf(q.account) < 0) accounts.push(q.account); });

  pool = { per: per, queue: queue, inflight: [], done: [], ticks: 0, accounts: accounts, stolen: {} };
}

pool.ticks = (pool.ticks || 0) + 1;

// ---------------------------------------------------------------------------
// Decide the one thing to do now.
//
// Polling comes first so that a finished clip is collected — and its account
// slot freed — before another submit is considered. Otherwise a long queue
// would keep every slot occupied by the oldest jobs.
// ---------------------------------------------------------------------------
const now = Date.now();
let action = null;

const due = pool.inflight
  .filter(function (j) { return now - Number(j.lastPollAt || 0) >= POLL_EVERY_MS; })
  .sort(function (a, b) { return Number(a.lastPollAt || 0) - Number(b.lastPollAt || 0); });

// Room on an account is counted per account, so three accounts at one job
// each means three clips in flight — the window P2 justified. Raising it
// past one is the separate, still unmeasured question of whether a single
// account will hold two generations at once.
const used = {};
pool.inflight.forEach(function (j) { used[j.account] = (used[j.account] || 0) + 1; });

// An account whose last submit failed rests for a minute (Pool Record sets
// `cooldownUntil` on the Pool Cooldown? edge, 2026-09-24). It takes no new
// submit and no stolen scene meanwhile, but its clips already in flight are
// polled as usual — that is the whole point: the old in-place 60 s Wait froze
// the polls of every account for as long as one account kept refusing.
const cooling = function (a) { return Number((pool.cooldownUntil || {})[a] || 0) > now; };

// WORK STEALING (2026-09-22). A clip can only be made on the account that
// minted its still — useapi refuses the pair with `Email mismatch` — so the
// film is cut into one contiguous block per account, and when one block runs
// out its account sits idle while the slowest block finishes alone. On the
// first real film that was the last 14 clips in 55 of the 105 minutes, one
// account at a time (db/port/parallel-accounts/etapa3.md). The fix: when an
// account has room and nothing of its own left, COPY the still of a scene
// from the busiest queue onto the idle account and make the clip there. The
// copy is the same two calls the cast-sheet replication uses — a fresh signed
// URL for the asset, then an upload addressed to the target account — and
// costs seconds. Nothing is written to the scene row: the copy is a transient
// Flow asset, and `Submit Video` reads `pool.stolen` to know which id and
// account to use. Clips use no palette reference, so consistency costs nothing.
//
// Guards: never the donor's LAST queued scene (a race with its own next
// submit), never a scene whose copy already failed (`noSteal`), never a scene
// without a still, and only when the target really has a free slot.
function pickSteal() {
  const accounts = pool.accounts || [];
  if (accounts.length < 2) return null;
  const idle = accounts.filter(function (a) { return (used[a] || 0) < pool.per && !cooling(a); });
  if (!idle.length) return null;
  const byAcct = {};
  pool.queue.forEach(function (q) { if (q.noSteal) return; (byAcct[q.account] = byAcct[q.account] || []).push(q); });
  let donor = '';
  let best = 1;
  Object.keys(byAcct).forEach(function (a) { if (byAcct[a].length > best) { best = byAcct[a].length; donor = a; } });
  if (!donor || byAcct[donor].length < 2) return null;
  const to = idle.filter(function (a) { return a !== donor; })[0];
  if (to === undefined) return null;
  const victim = byAcct[donor][byAcct[donor].length - 1];
  return { id: victim.id, from: donor, to: to, entry: victim };
}

if (due.length) {
  const j = due[0];
  action = { kind: 'poll', id: j.id, account: j.account, jobid: j.jobid };
} else {
  const next = pool.queue.find(function (q) { return (used[q.account] || 0) < pool.per && !cooling(q.account); });
  if (next) {
    action = { kind: 'submit', id: next.id, account: next.account };
  } else {
    const steal = pickSteal();
    if (steal) {
      action = { kind: 'steal', id: steal.id, from: steal.from, to: steal.to, entry: steal.entry };
    } else if (pool.inflight.length || pool.queue.length) {
      // A queue that is not empty with nothing in flight means every account
      // with work left is resting after a failed submit: wait it out.
      action = { kind: 'wait' };
    } else {
      action = { kind: 'done' };
    }
  }
}

// A clip that has been polled past the ceiling is abandoned rather than left to
// hold its account's slot forever. It keeps its place in `done` so the batch
// can finish; the approval gate will show it has no clip and the next pass
// picks it up, which is the same outcome the serial loop reaches.
if (action.kind === 'poll') {
  const j = pool.inflight.find(function (x) { return x.id === action.id; });
  if (j && Number(j.polls || 0) >= MAX_POLLS) {
    console.log('POOL: scene ' + j.id + ' polled ' + j.polls + ' times without finishing — dropping it from the pool');
    pool.inflight = pool.inflight.filter(function (x) { return x.id !== j.id; });
    pool.done.push(j.id);
    action = { kind: 'wait' };
  }
}

if (action.kind === 'done') {
  console.log('POOL: finished — ' + pool.done.length + ' scene(s) handled in ' + pool.ticks + ' tick(s)');
  return [{ json: { pool: pool, poolAction: 'done' } }];
}

if (action.kind === 'wait') {
  return [{ json: { pool: pool, poolAction: 'wait' } }];
}

// ---------------------------------------------------------------------------
// Emit the SCENE ROW itself, in exactly the shape Loop Scenes used to hand to
// Current Scene — which does Object.assign({}, $json, …), so the two extra keys
// survive all the way down to Poll Video Job and Pool Record.
// ---------------------------------------------------------------------------
const rows = $('Sort Scenes For Video').all();
const row = rows.find(function (r) { return r.json && String(r.json.id) === String(action.id); });
if (!row) {
  throw new Error('Pool Tick: scene ' + action.id + ' is not in Sort Scenes For Video output');
}
// A scene put back after a failed submit carries the still that attempt used
// (Pool Record, `freshImage`), which after the refusal ladder is newer than
// the row Sort Scenes For Video loaded at the start of the pass.
const fresh = (pool.freshImage || {})[action.id] || '';
const rowFields = Object.assign({}, row.json.fields || {});
if (fresh) rowFields['Image Media ID'] = fresh;

if (action.kind === 'steal') {
  const imageId = String(rowFields['Image Media ID'] || '');
  if (!imageId) {
    // Nothing to copy. Leave the scene where it is and try the next tick.
    action.entry.noSteal = true;
    console.log('POOL steal: scene ' + action.id + ' has no Image Media ID, leaving it on ' + (action.from || '(primary)'));
    return [{ json: { pool: pool, poolAction: 'wait' } }];
  }
  console.log('POOL steal ' + action.id + ': copying still ' + imageId.slice(-12) + ' from ' + (action.from || '(primary)') + ' to ' + action.to);
  return [{ json: { poolAction: 'steal', poolSceneId: action.id, poolFrom: action.from, poolTo: action.to, poolImageId: imageId, pool: pool } }];
}

return [{
  json: Object.assign({}, row.json, {
    fields: rowFields,
    poolAction: action.kind,
    poolSceneId: action.id,
    poolAccount: action.account,
    poolJobid: action.jobid || '',
    pool: pool,
  }),
}];


