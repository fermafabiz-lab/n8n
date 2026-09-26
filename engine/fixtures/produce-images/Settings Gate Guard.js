// The user confirms the overlay options on the site, which flips the
// project status off 'Setări Finale'. Release on ANY move away from the
// waiting state, not on one specific value: starting the render from the
// site's Restart button takes the project straight to 'Finalizat', so a
// test for 'Asamblare' alone would sit here for the full timeout while the
// video was already rendered. Don't hold an execution open forever if
// nobody confirms either: after ~2h assume the defaults and assemble.
//
// The project record comes from 'Fetch Final Settings' BY NAME, because the
// input of this node is now the scene list from 'Fetch Regen Flags'.
const proj = $('Fetch Final Settings').first().json.fields || {};
const status = String(proj['Status General'] || '');
const WAITING = 'Setări Finale';
const timedOut = $runIndex > 480;
const moved = status !== '' && status !== WAITING;

// Video regeneration is the ONLY regeneration with no webhook of its own —
// it is seen solely by 'Evaluate Video Approval', inside the video stage.
// So a scene flagged after the batch walked past that gate had nobody left
// to clear it: the flag sat forever (130 stranded base-wide when this was
// written) and the site showed a 'Regenerating…' badge that never resolved.
// While waiting here we watch for the flag and send the run back for
// another pass — the flagged scene carries 'Generare Video', so
// 'Sort & Cap Scenes' sorts it as outstanding work and it lands in the cap.
//
// ONE automatic bounce per scene per execution. If a pass does not clear
// the flag, bouncing again would only ping-pong between the two gates; the
// site has its own local exit for that scene (restartVideoRegen /
// cancelVideoRegen).
const flagged = $input.all()
  .filter(r => ((r.json.fields || {})['Regenerează Video'] === true))
  .map(r => r.json.id)
  .filter(Boolean);

const sd = $getWorkflowStaticData('global');
const key = 'sgBounced_' + $execution.id;
// Per-execution note, not a store: keep the map from growing without bound.
const old = Object.keys(sd).filter(k => k.startsWith('sgBounced_') && k !== key);
if (old.length > 10) old.slice(0, old.length - 10).forEach(k => delete sd[k]);
const bounced = new Set(sd[key] || []);
const fresh = flagged.filter(id => !bounced.has(id));
const regenPending = !moved && !timedOut && fresh.length > 0;
if (regenPending) {
  fresh.forEach(id => bounced.add(id));
  sd[key] = Array.from(bounced);
  console.log('Settings gate: ' + fresh.length + ' scene(s) flagged for video regeneration — going back for another pass: ' + fresh.join(', '));
} else if (flagged.length && !moved) {
  console.log('Settings gate: ' + flagged.length + ' scene(s) still flagged for video regeneration, already retried this run — holding at the gate.');
}

return [{ json: { status, confirmed: moved || timedOut, timedOut, regenPending, flagged: flagged.length } }];