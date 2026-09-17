// How long a regeneration has been waiting — the one rule, pinned.
//
//   npm run check:regen-wait
//
// A regeneration is a promise the site makes and only a live n8n batch can
// keep: the site sets a flag, and the only writer that clears it runs inside
// a media-generation execution, past every earlier gate of the whole film. So
// the badge could say "Regenerating…" forever, and it read exactly the same
// in second one and in minute forty, whether something was working on it or
// nothing was running at all.
//
// The producer could not tell those apart and the site advised Pause — which
// throws the in-flight generation away. `db/001` had already provided for
// this ("the `*_at` columns make staleness a query … One rule covers every
// flag, including the ones added later"); `regenSinceOf` is that one rule and
// this is what stops it drifting. Full account: db/port/regen-unstick/.
import { regenSinceOf, buildScene } from '@/lib/data/derive';

let pass = 0;
const fails = [];
const is = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const NONE = { regenImage: false, regenVideo: false, regenVoice: false };
const T1 = '2026-09-17T13:47:23.000Z'; // the producer's first click
const T2 = '2026-09-17T13:47:26.000Z'; // the second, three seconds later
const T3 = '2026-09-17T14:10:00.000Z';

// ---- nothing in flight ----------------------------------------------------
is('no flag set', regenSinceOf(NONE), null);
is('no flag set, stamps left over from a finished one', regenSinceOf({ ...NONE, regenVideoAt: T1 }), null);

// ---- one flag, one answer -------------------------------------------------
is('video', regenSinceOf({ ...NONE, regenVideo: true, regenVideoAt: T1 }), T1);
is('image', regenSinceOf({ ...NONE, regenImage: true, regenImageAt: T2 }), T2);
is('voice', regenSinceOf({ ...NONE, regenVoice: true, regenVoiceAt: T3 }), T3);

// ---- a flag with no timestamp says NOTHING, never "just now" ---------------
// Every Airtable-era row and every row written before the stamping trigger is
// in this state. Reporting `now` would invent a reassurance: the badge would
// read "just now" on a flag that had been stranded for a week, which is the
// precise lie this whole change exists to stop telling.
is('video flag, no stamp', regenSinceOf({ ...NONE, regenVideo: true }), null);
is('video flag, null stamp', regenSinceOf({ ...NONE, regenVideo: true, regenVideoAt: null }), null);
is('flag set, only ANOTHER flag stamped', regenSinceOf({ ...NONE, regenVideo: true, regenImageAt: T1 }), null);

// ---- several flags: the OLDEST wins ---------------------------------------
// Approving a picture queues a clip automatically, so a scene really can
// carry two. The honest answer to "how long has this been waiting" is the
// oldest request; taking the newest would restart the clock every time a
// second one landed, and a wait that keeps resetting never looks old enough
// to question — which is how it stayed invisible for so long.
is('video then image: oldest', regenSinceOf({ regenImage: true, regenVideo: true, regenVoice: false, regenImageAt: T2, regenVideoAt: T1 }), T1);
is('image then video: oldest', regenSinceOf({ regenImage: true, regenVideo: true, regenVoice: false, regenImageAt: T1, regenVideoAt: T2 }), T1);
is('all three', regenSinceOf({ regenImage: true, regenVideo: true, regenVoice: true, regenImageAt: T3, regenVideoAt: T2, regenVoiceAt: T1 }), T1);
// A set flag whose own stamp is missing must not silence a sibling that has one.
is('one stamped, one not', regenSinceOf({ regenImage: true, regenVideo: true, regenVoice: false, regenVideoAt: T2 }), T2);

// ---- garbage in the column is not a date ----------------------------------
is('unparseable stamp', regenSinceOf({ ...NONE, regenVideo: true, regenVideoAt: 'not a date' }), null);
is('unparseable beside a good one', regenSinceOf({ regenImage: true, regenVideo: true, regenVoice: false, regenImageAt: 'nope', regenVideoAt: T2 }), T2);

// ---- and it reaches the Scene the board renders ----------------------------
const raw = {
  id: 'recX', order: 102, narration: 'a line', imagePrompt: null, imageUrl: null,
  videoUrl: null, storedVideoUrl: null, voiceUrl: null, sceneApproved: true,
  imageApproved: true, voiceApproved: true, videoApproved: false,
  regenImage: false, regenVideo: true, regenVoice: false, regenVideoAt: T1,
  note: null, evidenceRef: null, needsFactCheck: false, videoPrompt: null,
  versions: [], statusRaw: 'Generare Video',
};
is('buildScene carries it', buildScene(raw, 0).regenSince, T1);
is('buildScene: none in flight', buildScene({ ...raw, regenVideo: false }, 0).regenSince, null);
// The Airtable adapter sets no *At fields at all; that must degrade, not throw.
const { regenVideoAt, ...noStamps } = raw;
is('an adapter with no timestamps at all', buildScene(noStamps, 0).regenSince, null);

if (fails.length) {
  console.error(`check:regen-wait — ${fails.length} FAILED`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`check:regen-wait — ${pass}/${pass} passed`);
