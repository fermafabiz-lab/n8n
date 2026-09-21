// The model answers a JSON object because it was asked for one
// (`response_format: json_object`), but a refusal, a timeout or a model that
// decides to wrap it in prose all arrive here too, and the button must fail
// as a dead button rather than as a broken page. Anything unreadable leaves
// with no title, and the route turns that into "nothing was changed".
const asked = $('Build Episode Prompt').first().json;
if (asked.skip) return [{ json: { title: null, idea: null } }];
let raw = '';
try { raw = String((($json.choices || [])[0] || {}).message?.content || ''); } catch (e) { raw = ''; }
let out = {};
try {
  out = JSON.parse(raw);
} catch (e) {
  // A fenced or chatty answer: take the first {...} block and try once more.
  const m = /\{[\s\S]*\}/.exec(raw);
  try { out = m ? JSON.parse(m[0]) : {}; } catch (e2) { out = {}; }
}
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().replace(/^["'“]+|["'”]+$/g, '').trim().slice(0, max);
const title = clean(out.title, 160);
const idea = clean(out.idea, 1200);
if (!title) {
  console.log('EPISODE EMPTY ' + asked.series_id + ': ' + JSON.stringify($json).slice(0, 300));
  return [{ json: { title: null, idea: null } }];
}
console.log('EPISODE ' + asked.series_id + ' #' + asked.episode_no + ': ' + title);
return [{ json: { title: title, idea: idea || null } }];
