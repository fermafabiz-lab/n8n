// Fold the result of ONE tick back into the pool, then hand control to Pool Tick.
//
// Five edges arrive here, and they mean different things. They are told apart by
// $prevNode.name rather than by sniffing the item's shape, because the shapes
// are whatever the previous node happened to return (an HTTP response, a
// Postgres result, Current Scene's object) and a shape test would silently
// mis-read the day one of them changes.
//
// With the pool OFF this node is a pass-through: Pool Tick never ran, so there
// is no state, and Pool Return? sends the item on to Loop Scenes exactly as
// before. Nothing about the serial path changes.

let pool = null;
try { pool = $('Pool Tick').first().json.pool || null; } catch (e) { pool = null; }

if (!pool) {
  // Pool is off. Pass the item through untouched.
  return $input.all();
}

let from = '';
try { from = String($prevNode.name || ''); } catch (e) { from = ''; }

let scene = null;
try { scene = $('Current Scene').first().json; } catch (e) { scene = null; }
const sceneId = String((scene && scene.id) || '');

const inflight = pool.inflight || [];
const queue = pool.queue || [];
const done = pool.done || [];

const drop = function (id) {
  pool.inflight = inflight.filter(function (j) { return j.id !== id; });
};
const unqueue = function (id) {
  pool.queue = queue.filter(function (q) { return q.id !== id; });
};

if (from === 'Pool Submitted?') {
  // A job was accepted by Flow. This covers the first submit of a scene AND a
  // motion re-roll, which resubmits from inside a POLL tick — so the entry is
  // replaced rather than added, and the poll counter starts again.
  let jobid = '';
  try { jobid = String($('Submit Video').first().json.jobid || ''); } catch (e) { jobid = '';}
  const q = queue.find(function (x) { return x.id === sceneId; });
  // A resubmit from inside a poll tick — a motion re-roll, or the refusal
  // ladder after a new still — arrives on a RELOADED scene row that carries no
  // poolAccount, and its queue entry was removed on the first submit. Before
  // 2026-09-22 that filed the new job under account '' and freed the real
  // account's slot while the job was still running, so the pool could put a
  // second job on that account. The entry being replaced knows the account.
  const prev = inflight.find(function (x) { return x.id === sceneId; });
  const account = (q && q.account) || (scene && scene.poolAccount) || (prev && prev.account) || '';
  drop(sceneId);
  unqueue(sceneId);
  if (jobid) {
    pool.inflight.push({ id: sceneId, account: account, jobid: jobid, polls: 0, lastPollAt: Date.now() });
    console.log('POOL submit ' + sceneId + ' on ' + (account || '(primary)') + ' → job ' + jobid + ' (' + pool.inflight.length + ' in flight)');
  } else {
    // Accepted with no jobid is not something to retry blindly — the scene is
    // set aside and the next pass will find it without a clip.
    done.push(sceneId);
    pool.done = done;
    console.log('POOL submit ' + sceneId + ': no jobid in the response, setting the scene aside');
  }
} else if (from === 'Pool Retry?') {
  // The job exists and is not finished yet. Only the counters move.
  const j = inflight.find(function (x) { return x.id === sceneId; });
  if (j) {
    j.polls = Number(j.polls || 0) + 1;
    j.lastPollAt = Date.now();
  }
} else {
  // Update Scene Record (the clip landed), Mark Video Prompt Rejected (given up
  // on), or Needs Clip? saying this scene already had one. Either way the scene
  // is off the pool's books and its account slot is free.
  drop(sceneId);
  unqueue(sceneId);
  if (done.indexOf(sceneId) < 0) done.push(sceneId);
  pool.done = done;
  console.log('POOL settled ' + sceneId + ' via ' + (from || '?') + ' (' + pool.inflight.length + ' in flight, ' + (pool.queue || []).length + ' queued)');
}

return [{ json: { pool: pool } }];
