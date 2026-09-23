// Put SOURCED facts back into a script the re-check made shorter — and
// refuse, one sentence at a time, anything that is filler dressed as a fact.
//
// THIS IS `FC Fill Apply` for the ⟳ Re-check button, and the guard between the
// two SHARED GUARD markers is byte-identical to it (the harness asserts so).
// What differs is the payload on each side: the re-check hands back TEXT that
// replaces a row the producer is reading, carries the hook as chapter 0, and
// writes through `DS Write`, which reads `$json`.
//
// THE TARGET IS `preCheckWords`, the body the film weighed before Deep Search
// ever touched it — recorded by the first pass and carried forward by every
// re-check, so a second press cannot quietly lower the bar the first one set.
//
// PAST THE SCRIPT GATE NOTHING GETS HERE: `DS Top Up?` requires `mayRewrite`,
// for the same reason `DS Resolve` freezes the rewrite — the scenes carry
// their own copy of every line and their own recordings by then.
//
// BY NAME, NOT `$json`: an agent REPLACES the payload with `{output}`.
const g = $('DS Apply').first().json;
const fill = (g && g.fill) || {};
let raw = '';
try {
  raw = String($('DS Fill').first().json.output || '');
} catch (e) {
  raw = '';
}

// ── SHARED GUARD ── byte-identical in `FC Fill Apply` and `DS Fill Apply`.
// `scripts/check-fact-check.mjs` asserts the two copies match, so change both.

// NARRATION GUARD'S OWN DETECTORS, byte for byte — not a second opinion about
// what filler is. `Narration Guard` measured them on 2026-09-13 against nine
// real scripts from the library, and the real scripts carry NONE of them: 0.0
// texture words per hundred, 0% of sentences opening on scenery. A ratio makes
// sense over a whole narration; over a handful of added sentences any hit is
// the thing the producer asked to be spared, so here one hit drops the
// sentence. The harness asserts each regex still equals the committed guard in
// `db/port/story-close/paste/cs-Narration_Guard.js`.
const TEXTURE = /\b(?:glossy|gleam\w*|glint\w*|glow\w*|shimmer\w*|slick|matte|hazy|haze|mist(?:y|ier|iest|s|ed|ing)?|spray|sparks?|strob\w*|puls\w*|flash\w*|reflections?|sheen|striped|printed|tinted|chrome|glare)\b/i;
const CAMERA = /\b(?:shot|framed|camera|angle|close-?ups?|lens|foreground|background|silhouettes?|vantage)\b/i;
const SCENERY = /^(?:the\s+)?(?:rain|snow|fog|mist|wind|light|sunlight|daylight|dusk|dawn|night|morning|shadows?|road|sky|sea|water|river|walls?|floor|air|sun|streets?|city|harbou?r|roof|room|door|window|glass|steel|stone|concrete|smoke|dust|steam|sparks|sirens?|lamps?|lights|warehouses?|containers?|towers?|cranes?|barges?|traffic)\b/i;
const COMMENTARY = /\b(?:that is (?:the|how|what|why)|this is (?:how|what|why)|the answer is|the lesson (?:is|here)|what (?:changes|matters|counts) is|the truth is|the point is|in many ways|the real (?:question|reason|story) is|and that is (?:the|how|what|why))\b/i;
const DEFINITION = /^(?:a|an)\s+[a-z][a-z\s-]{1,40}?\s+(?:is|are)\s+(?:a|an|the|any|one)\s+[a-z][a-z\s-]{2,}\b(?:that|which|who|where|used|driven|placed|made|designed|built|whose)\b|^(?:a|an|the)?\s*[a-z][a-z\s-]{1,30}?\s+(?:means|refers to|is called|is known as|is defined as)\b|^(?:in other words|put simply|simply put|that means|this means)\b/i;
const META = /\b(?:the (?:film|camera|viewer|viewers|documentary|video|audience|narration|narrator|story we|chapter)|this (?:chapter|film|video|documentary|story)|turning point|in this (?:film|video|story|chapter)|as we (?:see|follow|watch|will see)|we (?:now )?(?:see|watch|follow|turn)|let us|let's|our story|the next chapter|before we|as you (?:watch|can see|will see))\b/i;

// A sentence the size of a fact. Under six words is a fragment — `Narration
// Guard` flags inventories of those — and over forty-five is a paragraph
// passing itself off as one addition.
const MIN_WORDS = 6;
const MAX_WORDS = 45;
// How much of a NEW sentence's content may already sit in ONE existing
// sentence before it counts as saying that sentence again. A genuinely new
// fact about the same subject shares the subject — "Google", "Maps", "Sydney"
// — and little else; a restatement shares most of what it says.
const REPEAT_SHARE = 0.6;

const wc = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const STOP = new Set(
  (
    'the a an and or but so then than that this these those there their they them its it his her he she ' +
    'was were is are be been being has have had with from into onto over under after before during while ' +
    'when where which who whom whose what why how for of on in at by to as not no nor also only just ' +
    'more most less many much some such each every other another same both either neither own very ' +
    'would could should might must will shall can may did does doing done about above across against ' +
    'along among around behind below beside between beyond inside outside through throughout toward ' +
    'towards upon within without once still even ever again later earlier first last next'
  ).split(' '),
);
const contentWords = (s) => new Set(norm(s).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)));
const sentencesOf = (t) =>
  String(t || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

// A FACT HAS A HANDLE: a number, a year, or a name. This is the rule that does
// most of the work against filler, and it needs no vocabulary list — a
// sentence about the light on the water has no date and no proper noun in it,
// and a sentence about what happened almost always has one. Sentence-initial
// capitals are kept (a sentence may open on "Google"); function words that
// merely START a sentence are filtered by STOP.
const handles = (s) => {
  const out = new Set();
  for (const w of String(s || '').split(/\s+/)) {
    const bare = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!bare) continue;
    if (/\d/.test(bare)) out.add(bare.toLowerCase());
    else if (/^[A-Z][A-Za-z'’-]{2,}$/.test(bare) && !STOP.has(bare.toLowerCase())) out.add(bare.toLowerCase());
  }
  return out;
};

// The pack as the judge saw it: `E7. <claim> [<source>, <date> — <url>]`.
const parsePack = (packList) => {
  const map = new Map();
  for (const line of String(packList || '').split('\n')) {
    const m = line.match(/^\s*([A-Za-z]*\d+)\.\s+(.*)$/);
    if (m) map.set(m[1].toUpperCase(), m[2]);
  }
  return map;
};

// SAME LINE FORMAT AS `FC Source`, and for the same reason: the model that can
// search the web (`Research Model`) answers in text, not through a structured
// parser. SENTENCE comes LAST and runs to the end of the line, so a sentence
// that happens to contain a pipe still arrives whole.
const parseProposals = (raw) => {
  const out = [];
  const re = /ADD:\s*(\d+)\s*\|\s*AFTER:\s*([^|\n]*?)\s*\|\s*REF:\s*([^|\n]*?)\s*\|\s*SOURCE:\s*([^|\n]*?)\s*\|\s*URL:\s*([^|\s]*)\s*\|\s*SENTENCE:\s*([^\n]+)/gi;
  let m;
  while ((m = re.exec(String(raw || ''))) !== null) {
    out.push({
      chapter: Number(m[1]),
      after: m[2].trim(),
      ref: m[3].trim().toUpperCase(),
      source: m[4].trim(),
      url: m[5].trim().replace(/[).,\]]+$/, ''),
      sentence: m[6].trim(),
    });
  }
  return out;
};

// WHERE A SENTENCE LANDS, and whether it may land at all. After the sentence it
// names; otherwise at the end of its chapter. The LAST chapter's final sentence
// is the film's closing line: nothing is ever placed after it, and END in that
// chapter lands just before it — the same unit `DS Resolve` protects as
// `closingSentence`, because this chain only ever runs on documentaries and a
// documentary's last paragraph often holds its last event (the Google Maps
// probe, 2026-09-23: protecting the whole paragraph pushed a sentence about the
// API in front of the sentence that introduces the API).
//
// Positions are END INDICES in the original text, so whatever stood after a
// sentence — a space or a paragraph break — is kept exactly.
const endsOf = (t) => {
  const ends = [];
  const re = /[.!?…]["”’)]*(?=\s|$)/g;
  let m;
  while ((m = re.exec(t)) !== null) ends.push(m.index + m[0].length);
  if (!ends.length || ends[ends.length - 1] < t.length) ends.push(t.length);
  return ends;
};

// A NEW SENTENCE MUST NOT TAKE THE NEXT ONE'S SUBJECT. Inserted just before a
// sentence that opens on "It", "This", "They"…, it becomes what that word
// points at. Measured on the same probe: "In November 2005, Google created the
// Google Maps API Blog." placed before the closing line "It had become a
// platform other people could build on" would have made the film's last line
// a sentence about a blog.
const PRONOUN_OPEN = /^(?:It|Its|This|These|That|Those|They|Their|Them|He|His|She|Her)\b/;

// A DATE, as a range, from the first date a sentence names — to catch a
// sentence placed out of date order. Only a DEFINITE contradiction counts: a
// bare year spans the whole year, "early/mid/late" a third of it.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateOf = (s) => {
  const t = String(s || '');
  let m = t.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const v = Number(m[3]) * 10000 + (MONTHS.indexOf(m[1]) + 1) * 100 + Number(m[2]);
    return { lo: v, hi: v };
  }
  m = t.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/);
  if (m) {
    const b = Number(m[2]) * 10000 + (MONTHS.indexOf(m[1]) + 1) * 100;
    return { lo: b + 1, hi: b + 31 };
  }
  m = t.match(/\b(early|mid|late)[-\s](\d{4})\b/i);
  if (m) {
    const y = Number(m[2]) * 10000;
    const r = { early: [101, 430], mid: [401, 930], late: [901, 1231] }[m[1].toLowerCase()];
    return { lo: y + r[0], hi: y + r[1] };
  }
  m = t.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  if (m) {
    const y = Number(m[1]) * 10000;
    return { lo: y + 101, hi: y + 1231 };
  }
  return null;
};

const place = (text, after, sentence, isLast) => {
  const t = String(text || '').trim();
  const ends = endsOf(t);
  const starts = ends.map((e, i) => {
    if (i === 0) return 0;
    let k = ends[i - 1];
    while (k < t.length && /\s/.test(t[k])) k++;
    return k;
  });
  const n = ends.length;
  const at = (i) => t.slice(starts[i], ends[i]);
  // Insert AFTER sentence i; -1 means before the first. The closing line of the
  // last chapter may never have anything after it.
  const lastAllowed = isLast ? n - 2 : n - 1;
  const a = String(after || '').trim();
  const aIdx = a && a.toUpperCase() !== 'END' ? t.indexOf(a) : -1;
  let i = lastAllowed;
  if (aIdx >= 0) {
    const aEnd = aIdx + a.length;
    i = ends.findIndex((e) => e >= aEnd);
    if (i < 0 || i > lastAllowed) i = lastAllowed;
  }
  while (i + 1 < n && PRONOUN_OPEN.test(at(i + 1))) i++;
  if (i > lastAllowed) return { drop: "would take the next sentence's subject" };

  const mine = dateOf(sentence);
  if (mine) {
    let before = null;
    for (let j = i; j >= 0 && !before; j--) before = dateOf(at(j));
    let later = null;
    for (let j = i + 1; j < n && !later; j++) later = dateOf(at(j));
    if ((before && mine.hi < before.lo) || (later && mine.lo > later.hi)) return { drop: 'out of date order' };
  }

  if (i < 0) return { text: sentence + ' ' + t };
  return { text: t.slice(0, ends[i]) + ' ' + sentence + t.slice(ends[i]) };
};

function topUp(chaptersIn, fill, raw) {
  const chapters = (Array.isArray(chaptersIn) ? chaptersIn : []).map((c) => ({ ...c }));
  const byNum = new Map(chapters.map((c) => [Number(c.chapter_number), c]));
  const lastChapter = Math.max(0, ...chapters.map((c) => Number(c.chapter_number) || 0));
  const pack = parsePack(fill.packList);
  const budget = Math.max(0, Number(fill.gapWords) || 0);
  const proposals = parseProposals(raw);
  const exhausted = /DONE:\s*exhausted/i.test(String(raw || ''));

  const existing = [];
  for (const c of chapters) for (const s of sentencesOf(c.narrator_script)) existing.push(contentWords(s));

  // NEVER BACK AGAIN. A sentence the top-up added on an earlier press and the
  // fact-checker has since flagged. Without this the re-check button
  // ping-pongs it: one press adds it, the next cuts it, which reopens the gap,
  // and the press after that adds it back.
  const rejected = (Array.isArray(fill.rejected) ? fill.rejected : []).map(contentWords).filter((w) => w.size);

  const added = [];
  const dropped = {};
  const drop = (why) => {
    dropped[why] = (dropped[why] || 0) + 1;
  };
  const usedRefs = new Set();
  let spent = 0;
  let budgetHit = false;

  for (const p of proposals) {
    if (budgetHit) {
      drop('over budget');
      continue;
    }
    let sentence = p.sentence.replace(/\s+/g, ' ').trim();
    if (sentence && !/[.!?…]["”’)]*$/.test(sentence)) sentence += '.';
    const n = wc(sentence);
    const ch = byNum.get(p.chapter);

    if (!ch || p.chapter === 0) { drop('no such chapter, or the hook'); continue; }
    if (n < MIN_WORDS || n > MAX_WORDS) { drop('not one sentence of fact'); continue; }
    if (TEXTURE.test(sentence) || CAMERA.test(sentence) || SCENERY.test(sentence)) { drop('describes the picture'); continue; }
    if (COMMENTARY.test(sentence) || META.test(sentence) || DEFINITION.test(sentence)) { drop('comments instead of telling'); continue; }

    // EVERY SENTENCE NAMES ITS SOURCE. A pack claim that exists, or a live
    // find with a real URL — filler has no source, and that is the sharpest
    // single test available.
    const live = p.ref === 'LIVE';
    const claim = live ? '' : pack.get(p.ref);
    if (live ? !/^https?:\/\/[^\s/]+\.[^\s]+/i.test(p.url) || !p.source : !claim) { drop('no source'); continue; }
    if (!live && usedRefs.has(p.ref)) { drop('one claim stretched into two sentences'); continue; }

    // …AND CARRIES A HANDLE OF ITS OWN, which for a pack claim must be one the
    // claim also carries. A sentence that cites E7 and shares no number, year or
    // name with E7 is not E7's fact, whatever its REF says.
    const mine = handles(sentence);
    if (!mine.size) { drop('no date, number or name'); continue; }
    if (!live) {
      const theirs = handles(claim);
      let shared = false;
      for (const h of mine) if (theirs.has(h)) { shared = true; break; }
      if (!shared) { drop('does not carry its claim'); continue; }
    }

    // NOTHING THE FILM ALREADY SAYS, including what this step has just added.
    const words = contentWords(sentence);
    let repeat = false;
    if (words.size >= 3) {
      for (const other of existing) {
        let k = 0;
        for (const w of words) if (other.has(w)) k++;
        if (k / words.size >= REPEAT_SHARE) { repeat = true; break; }
      }
    }
    if (repeat) { drop('repeats the script'); continue; }
    let again = false;
    if (words.size >= 3) {
      for (const other of rejected) {
        let k = 0;
        for (const w of words) if (other.has(w)) k++;
        if (k / words.size >= REPEAT_SHARE) { again = true; break; }
      }
    }
    if (again) { drop('rejected by the fact-checker before'); continue; }

    // WHERE IT GOES, and whether it may go there at all — out of date order, or
    // in front of a pronoun it would steal, is a sentence that changes what the
    // script says around it.
    const placed = place(ch.narrator_script, p.after, sentence, Number(ch.chapter_number) === lastChapter);
    if (placed.drop) { drop(placed.drop); continue; }

    // THE BUDGET IS A CEILING, cut from the LAST proposal — which is what the
    // prompt tells the model, so the facts it chose to write first survive.
    if (spent + n > budget) { budgetHit = true; drop('over budget'); continue; }

    ch.narrator_script = placed.text;
    spent += n;
    existing.push(words);
    if (!live) usedRefs.add(p.ref);
    added.push({ chapter: p.chapter, sentence, ref: p.ref, source: p.source, url: p.url });
  }

  return {
    chapters,
    added,
    addedWords: spent,
    proposed: proposals.length,
    dropped,
    exhausted,
  };
}
// ── END SHARED GUARD ──

const result = topUp(fill.chapters, fill, raw);
const chapters = result.chapters;

// Reassembled in EXACTLY the shape `DS Apply` and `Combine Chapters` write, so
// `DS Write`'s "is distinct from" sees a real change and nothing else.
const script = chapters
  .map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title || ''}]\n${String(c.narrator_script || '').trim()}`)
  .join('\n\n');
const bodyNow = chapters
  .filter((c) => Number(c.chapter_number) !== 0)
  .reduce((n, c) => n + wc(c.narrator_script), 0);

const report = { ...(g.fcReport || {}) };
report.filled = {
  sentences: result.added.length,
  words: result.addedWords,
  live: result.added.filter((a) => a.ref === 'LIVE').length,
  // THE ANSWER THE PRODUCER ASKED FOR, in one field: the research ran out
  // before the film got its length back. Not a failure — the subject is told
  // in full at this length.
  exhausted: result.exhausted || undefined,
  shortBy: Math.max(0, (Number(fill.gapWords) || 0) - result.addedWords) || undefined,
  proposed: result.proposed,
  dropped: Object.keys(result.dropped).length ? result.dropped : undefined,
  added: result.added,
};
// `short` belongs to `DS Apply`, which sets it only when a correction took the
// film under its floor. The top-up may lift it back over; it never invents one.
if (report.short) {
  const floor = Number(report.short.min) || 0;
  report.short = floor > 0 && bodyNow < floor ? { words: bodyNow, min: floor } : undefined;
}

console.log(
  'DEEP SEARCH re-run top-up: ' + result.added.length + ' sentence(s), ' + result.addedWords + ' of ' +
    (fill.gapWords || 0) + ' words given back' + (result.exhausted ? ' — the research ran out' : '') +
    (Object.keys(result.dropped).length ? '; dropped ' + JSON.stringify(result.dropped) : ''),
);

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

// `DS Apply`'s shape exactly — `DS Write` reads it off `$json`, and `DS Save`
// reads this node by name when it ran. The hook is never touched here, so
// `hookChanged` and `editing64` pass straight through.
return [
  {
    json: {
      projectId: g.projectId,
      projectName: g.projectName,
      scriptChanged: !!g.scriptChanged || result.added.length > 0,
      hookChanged: g.hookChanged,
      script,
      fcReport: report,
      fcReport64: b64(JSON.stringify(report)),
      script64: b64(script),
      editing64: g.editing64,
    },
  },
];
