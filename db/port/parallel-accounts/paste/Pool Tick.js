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
// Video. Every later entry arrives from Pool Record carrying the state.
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
    queue.push({ id: String(id), account: acct[id] || '' });
  });

  const byAcct = {};
  queue.forEach(function (q) { byAcct[q.account || '(primary)'] = (byAcct[q.account || '(primary)'] || 0) + 1; });
  console.log('POOL: ' + queue.length + ' scene(s) to generate, ' + per + ' job(s) per account, split ' + JSON.stringify(byAcct));

  pool = { per: per, queue: queue, inflight: [], done: [], ticks: 0 };
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

if (due.length) {
  const j = due[0];
  action = { kind: 'poll', id: j.id, account: j.account, jobid: j.jobid };
} else {
  // Room on an account is counted per account, so three accounts at one job
  // each means three clips in flight — the window P2 justified. Raising it
  // past one is the separate, still unmeasured question of whether a single
  // account will hold two generations at once.
  const used = {};
  pool.inflight.forEach(function (j) { used[j.account] = (used[j.account] || 0) + 1; });
  const next = pool.queue.find(function (q) { return (used[q.account] || 0) < pool.per; });
  if (next) {
    action = { kind: 'submit', id: next.id, account: next.account };
  } else if (pool.inflight.length) {
    action = { kind: 'wait' };
  } else {
    action = { kind: 'done' };
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

return [{
  json: Object.assign({}, row.json, {
    poolAction: action.kind,
    poolSceneId: action.id,
    poolAccount: action.account,
    poolJobid: action.jobid || '',
    pool: pool,
  }),
}];
