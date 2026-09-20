// One line per episode, always in the same shape — `Episode N — Title:
// summary` — because the shape is the key. Append Recap drops any earlier
// line for the same episode number before adding this one, so approving
// the script twice (an edit, hands-off mode) REPLACES the line rather
// than doubling it. Base64 because the line is free text from a model and
// a Postgres node must never see a dollar sign followed by a digit in its
// query text (CLAUDE.md, "Cross-cutting gotchas").
const asked = $('Build Recap Prompt').first().json;
let raw = '';
try { raw = String((($json.choices || [])[0] || {}).message?.content || ''); } catch (e) { raw = ''; }
raw = raw.replace(/\s+/g, ' ').trim().replace(/^["'“]+|["'”]+$/g, '').trim();
if (!raw || raw.length < 20) {
  console.log('RECAP EMPTY ' + asked.project_id + ': ' + JSON.stringify($json).slice(0, 300));
  return [];
}
const countWords = (s) => s.split(/\s+/).filter(Boolean).length;
// The budget lives in Build Recap Prompt (80 words) and is OBEYED — eight runs
// of the measured wording across two films came back 71-80. This is the net
// under it, not the mechanism: 25% of headroom, so an ordinary long answer is
// never touched, and a model that starts ignoring the prompt again cannot put
// a 130-word paragraph in front of the producer.
//
// It trims WHOLE SENTENCES and never cuts inside one, because a half sentence
// still reads like a recap — a silent failure, the worse kind. The first
// sentence is always kept, so an unpunctuated runaway falls through to the
// character guard below rather than to nothing.
//
// If RECAP LONG ever appears in a log, the prompt has drifted and the right fix
// is to re-run the probe in db/port/series-recap/README.md, not to raise this.
const WORD_CEILING = (Number(asked.words_asked) || 80) + Math.round((Number(asked.words_asked) || 80) * 0.25);
let summary = raw;
if (countWords(summary) > WORD_CEILING) {
  const sentences = summary.match(/[^.!?]+[.!?]+["'”’)\]]*\s*/g) || [summary];
  let kept = '';
  for (const sentence of sentences) {
    if (kept && countWords(kept + sentence) > WORD_CEILING) break;
    kept += sentence;
  }
  kept = kept.trim();
  console.log('RECAP LONG ' + asked.project_id + ': ' + countWords(raw) + ' words against a ceiling of ' + WORD_CEILING + ' — kept ' + countWords(kept) + '. The word cap in Build Recap Prompt is being ignored; re-measure it.');
  summary = kept || summary;
}
// Last resort, for output with no sentence boundaries at all. It has to clear
// the word ceiling by a wide margin or it would be doing the cutting instead.
summary = summary.slice(0, 1000);
const line = 'Episode ' + asked.episode_no + ' — ' + asked.title.replace(/[\r\n]+/g, ' ') + ': ' + summary;
console.log('RECAP ' + asked.project_id + ': ' + line);
console.log('RECAP LEN ' + asked.project_id + ': ' + countWords(summary) + ' words / ' + summary.length + ' characters, asked for ' + (asked.words_asked || 80));
return [{ json: {
  project_id: asked.project_id,
  series_id: asked.series_id,
  line,
  line_b64: Buffer.from(line, 'utf8').toString('base64'),
  // `Episode N —%`: the space-dash after the number is what keeps
  // "Episode 1" from matching "Episode 10".
  like_pattern: 'Episode ' + asked.episode_no + ' —%',
} }];
