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
// as a recap. At 100 words a real line measured ~523 characters of summary, so
// 600 was about to start chopping; 800 leaves room for a long one and still
// stops a runaway. Move the two together.
const summary = raw.slice(0, 800);
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
