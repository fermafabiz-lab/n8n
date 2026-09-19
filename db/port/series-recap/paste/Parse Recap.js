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
// This has to clear the word cap in Build Recap Prompt or it silently cuts a
// sentence in half, which is the worse failure: a truncated recap still reads
// like a recap.
//
// And it has to clear it by a MARGIN, because the model treats the word cap as
// a suggestion and overshoots it by about a third — measured twice on the same
// episode: asked for 60 it wrote ~100 words / 591 characters, asked for 100 it
// wrote 128 words / 717. So the cap does not hold the length still, it moves
// it. 1000 keeps the next drift off the knife; it is a runaway guard, not the
// budget (composeSeriesLore's 8,000-character trim is the budget, and it drops
// the OLDEST lines first).
const summary = raw.slice(0, 1000);
const line = 'Episode ' + asked.episode_no + ' — ' + asked.title.replace(/[\r\n]+/g, ' ') + ': ' + summary;
console.log('RECAP ' + asked.project_id + ': ' + line);
return [{ json: {
  project_id: asked.project_id,
  series_id: asked.series_id,
  line,
  line_b64: Buffer.from(line, 'utf8').toString('base64'),
  // `Episode N —%`: the space-dash after the number is what keeps
  // "Episode 1" from matching "Episode 10".
  like_pattern: 'Episode ' + asked.episode_no + ' —%',
} }];
