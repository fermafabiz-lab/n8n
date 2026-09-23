// Put SOURCED facts back into a narration the corrections made shorter — and
// refuse, one sentence at a time, anything that is filler dressed as a fact.
//
// WHY THIS EXISTS. Since 2026-09-23 a correction is allowed to shorten the
// film (`FC Apply`, one-sided band). The producer's follow-up the same day:
// when Deep Search removes too much, give the running time back with real
// information — "dar daca nu mai exista informatii utile nu as vrea sa adauge
// filler asa cum facea inainte si sa stea sa descrie scena". Both halves are
// enforced here: `FC Fill` is asked for sourced facts up to the gap, and this
// node deletes every sentence that is not one.
//
// THE TARGET IS WHAT THE NARRATION WEIGHED BEFORE DEEP SEARCH TOUCHED IT — the
// producer's choice over "the full ordered length", because the draft already
// cleared `Narration Guard` at the length ordered, and filling to an abstract
// target would lengthen films that were short for reasons of their own.
//
// NEVER A REFUSAL OF THE WHOLE BATCH. Each proposed sentence stands or falls
// alone, so one bad sentence cannot cost the film three good ones — and if all
// of them fall, the narration is exactly what `FC Apply` handed over and the
// report says so.
//
// BY NAME, NOT `$json`: an agent REPLACES the payload with `{output}`, so the
// chapters come from `FC Apply` and the proposals from `FC Fill`.
const g = $('FC Apply').first().json;
const fill = (g && g.fill) || {};
let raw = '';
try {
  raw = String($('FC Fill').first().json.output || '');
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

// WHERE A SENTENCE LANDS. After the sentence it names, when that sentence is
// found verbatim; otherwise at the end of its chapter. The LAST chapter's final
// sentence is the exception, because it is the film's closing line: nothing is
// ever placed after it, and END in that chapter lands just before it.
//
// THE LINE, NOT THE PARAGRAPH — the same unit `DS Resolve` protects as
// `closingSentence`. The first version protected the whole final paragraph, and
// on the producer's Google Maps film (probe, 2026-09-23) that pushed a sentence
// about the API into the paragraph BEFORE the one that introduces the API: a
// documentary's last paragraph is often where its last event happens, and the
// resolution rule `db/port/story-close/` exists for is a Story and Kids rule,
// while this chain only ever runs on documentaries.
const place = (text, after, sentence, isLast) => {
  const t = String(text || '').trim();
  const lastSentence = sentencesOf(t).pop() || '';
  const a = String(after || '').trim();
  const anchorIsEnding = isLast && norm(a) === norm(lastSentence);
  if (a && a.toUpperCase() !== 'END' && t.includes(a) && !anchorIsEnding) {
    const at = t.indexOf(a) + a.length;
    return t.slice(0, at) + ' ' + sentence + t.slice(at);
  }
  if (!isLast) return t + ' ' + sentence;
  // Just before the closing line, keeping whatever whitespace stood there — a
  // paragraph break stays a paragraph break, with the new sentence opening it.
  const boundary = /[.!?…]["”’)]*\s+(?=\S)/g;
  let start = -1;
  let m;
  while ((m = boundary.exec(t)) !== null) start = m.index + m[0].length;
  if (start > 0) return t.slice(0, start) + sentence + ' ' + t.slice(start);
  return sentence + ' ' + t;
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

    // THE BUDGET IS A CEILING, cut from the LAST proposal — which is what the
    // prompt tells the model, so the facts it chose to write first survive.
    if (spent + n > budget) { budgetHit = true; drop('over budget'); continue; }

    ch.narrator_script = place(ch.narrator_script, p.after, sentence, Number(ch.chapter_number) === lastChapter);
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

// The Narration Guard shape again, rebuilt from the chapters as they now stand,
// exactly as `FC Apply` builds it.
const output = chapters
  .map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title || ''}]\n${String(c.narrator_script || '').trim()}`)
  .join('\n\n');
const words = chapters.reduce((n, c) => n + wc(c.narrator_script), 0);

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
// `short` belongs to `FC Apply`, which sets it only when a correction took the
// film under its floor. The top-up may lift it back over; it never invents one.
if (report.short) {
  const floor = Number(report.short.min) || 0;
  report.short = floor > 0 && words < floor ? { words, min: floor } : undefined;
}

console.log(
  'DEEP SEARCH top-up: ' + result.added.length + ' sentence(s), ' + result.addedWords + ' of ' + (fill.gapWords || 0) +
    ' words given back' + (result.exhausted ? ' — the research ran out' : '') +
    (Object.keys(result.dropped).length ? '; dropped ' + JSON.stringify(result.dropped) : ''),
);

return [
  {
    json: {
      output,
      retry: false,
      chapters,
      words,
      target: g.target,
      min: g.min,
      max: g.max,
      fcReport: report,
      fcReport64: Buffer.from(JSON.stringify(report), 'utf8').toString('base64'),
    },
  },
];
