const sd = $getWorkflowStaticData('global');
sd.prevImageUrl = '';
sd.prevImageId = '';
sd.anchorId = '';
// Every per-scene counter in this workflow lives here and is reset per
// pass: video polls / resubmits (batch loop), regen polls / resubmits (the
// gate), multi-voice polls, motion-prompt rewrites, submit cooldowns.
// They are keyed by scene id because $runIndex counts a node's runs across
// the WHOLE execution — and a pass now covers the whole film.
sd.polls = {};
sd.resubmits = {};
sd.regenPolls = {};
sd.regenResubmits = {};
sd.multiPolls = {};
sd.rewrites = {};
sd.submitCooldowns = {};
sd.imgRewrites = {};
sd.imgCooldowns = {};
sd.consistencyRerolls = {};
sd.consistencyNotes = {};
sd.muxPolls = {};
// 2026-09-14 — the motion judge's two counters were missed when that feature
// went live the day before, so `MAX_REROLLS = 1` meant one re-roll per scene
// for the LIFE OF THE n8n PROCESS rather than one per pass: a scene that spent
// its re-roll on one film could never earn another. `consistencyRerolls` and
// `consistencyNotes` above are the still-image judge's exact analogues and have
// always been reset here; these two belong beside them, and the comment at the
// top of this block already claims that EVERY per-scene counter lives here.
//
// NOT wholesale, though, and that is the whole subtlety. This node runs on
// every REGEN cycle as well as every batch pass — `If Video Regen Pending` →
// `Fetch Approved Scenes` → `Warm-up Cooldown` → here — and `RG Motion Prep`
// keys the SAME object as 'regen:<scene id>'. Clearing it outright would reset
// the regen counter on every cycle and hand each regenerated scene an unlimited
// supply of re-rolls, a whole Veo generation apiece. So reset only the BATCH
// keys and leave the 'regen:' ones to the gate that owns them.
sd.motionRerolls = sd.motionRerolls || {};
sd.motionNotes = sd.motionNotes || {};
for (const k of Object.keys(sd.motionRerolls)) if (!k.startsWith('regen:')) delete sd.motionRerolls[k];
for (const k of Object.keys(sd.motionNotes)) if (!k.startsWith('regen:')) delete sd.motionNotes[k];
const items = $input.all().slice();
const ord = it => { const f = it.json.fields || {}; return (typeof f['Ordine Scenă'] === 'number') ? f['Ordine Scenă'] : null; };
// "Done" is judged on the CLIP and the regen flags, never on the status
// text. It used to be the text ('Așteaptă Aprobare Video' / 'Finalizat'),
// and `VP Apply` stamped exactly that text on a scene whose clip had just
// been REFUSED by the video filter — so a refused scene sorted as finished,
// fell behind the cap on any film longer than 8 scenes, and was never
// generated again (Vegas, 71 scenes: 117, 118, 203 and 204 sat like that).
const pending = it => {
  const f = it.json.fields || {};
  const hasClip = String(f['Scene Final URL'] || '').startsWith('http');
  const flagged = f['Regenerează Video'] === true || f['Regenerează Imagine'] === true || f['Regenerează Voce'] === true;
  return !hasClip || flagged;
};
items.sort((a, b) => {
  const pa = pending(a), pb = pending(b);
  if (pa !== pb) return pa ? -1 : 1;
  const oa = ord(a), ob = ord(b);
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  const t = new Date(a.json.createdTime) - new Date(b.json.createdTime);
  if (t) return t;
  return a.json.id < b.json.id ? -1 : 1;
});
if (!items.length) throw new Error('No approved scenes found for this project.');
// A pass covers the WHOLE film: every take, every image, one combined gate,
// every clip, one video gate. The cap was 8 until 2026-09-01, which turned a
// 71-scene film into nine rounds of approvals; the site mirrors this number
// in MEDIA_BATCH_CAP. 200 is a sanity bound (a 12-minute film is ~90
// scenes), not a chunk size. Pending-first sorting stays so a repeat pass
// (refused scenes, regen flags) still converges.
const CAP = 200;
if (items.length > CAP) {
  console.log('Sort & Cap: ' + items.length + ' approved scenes, running ' + CAP + '; ' + (items.length - CAP) + ' left for the next run.');
}
return items.slice(0, CAP);
