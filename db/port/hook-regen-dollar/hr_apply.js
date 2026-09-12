// Turn the shots into the SQL that replaces the hook, one statement per item
// so HR Commit can run them inside one transaction: the old chapter-0 scenes
// go, the new ones are created through hov.at_create with exactly the fields
// Save scenes To Airtable1 writes, the hook chapter's script is rewritten,
// and the project's hookPlan is merged while hookRegen is cleared — the flag
// the site set before firing this run.
const prep = $('HR Prep').first().json;
const hook = $('HR Shots Prompt').first().json.hook;
let raw = String((((($json.choices || [])[0] || {}).message || {}).content) || '').trim();
raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
let parsed = {};
try { parsed = JSON.parse(raw) || {}; } catch (e) { throw new Error('hook-regen: the shot writer did not return JSON'); }
const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : (Array.isArray(parsed) ? parsed : []);
if (scenes.length !== hook.lines.length) throw new Error('hook-regen: asked for ' + hook.lines.length + ' shots, got ' + scenes.length);

// Canonicalise the continuity fields against the bible, diacritic-insensitive,
// as Validate Evidence Refs does; a name not in the bible is dropped.
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const names = (list) => (Array.isArray(list) ? list : []).map((e) => String((e && e.name) || '').trim()).filter(Boolean);
const bible = prep.bible || {};
const canon = (v, pool) => { const n = norm(v); const hit = pool.find((p) => norm(p) === n); return hit || ''; };
const locs = names(bible.locations), chars = names(bible.characters), objs = names(bible.objects);
const TOD = ['dawn', 'morning', 'day', 'afternoon', 'dusk', 'night', 'overcast', 'storm', 'interior'];

// Every literal is base64 and decoded by Postgres, and that is NOT tidiness —
// it is the only encoding that survives this node's own transaction.
//
// HR Commit runs `queryBatching: transaction`, and in that mode (unlike the
// default one every other Postgres node here uses) n8n hands the query to
// pg-promise WITH an empty values array, so pg-promise reads every `$` that
// is followed by a digit as a positional parameter and refuses the whole
// statement: "Variable $321 out of range. Parameters array length: 0".
// Dollar-quoting does not help — the closing `$` of `$hr$` in front of a
// hook beat reading "321 metres, standing in the Gulf" IS `$321`, and that
// is exactly how the first real rewrite died (execution 12490). Nor is a
// leading digit the only way in: `$1B` inside a sentence fails the same way,
// and this pipeline writes films about $1B hotels.
// Base64's alphabet has no `$` in it, so no data can ever form a placeholder.
// Measured both ways, transaction and default, in execution 12511.
const b64 = (s) => {
  const str = String(s);
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  return btoa(unescape(encodeURIComponent(str)));
};
const q = (s) => "convert_from(decode('" + b64(s) + "','base64'),'UTF8')";
const pid = prep.projectId;
const items = [];
items.push({ sql: 'delete from hov.scene where project_id = ' + q(pid) + ' and scene_order < 100' });
if (prep.hookChapterId) {
  items.push({ sql: 'update hov.chapter set chapter_script = ' + q(hook.lines.join('\n')) + ' where id = ' + q(prep.hookChapterId) });
}
scenes.forEach((s, i) => {
  const line = hook.lines[i];
  const silent = /^\s*\[SILENT\]/i.test(line);
  const dur = Number(s.scene_duration_seconds);
  const tags = [];
  const loc = canon(s.location, locs); if (loc) tags.push('loc:' + loc);
  (Array.isArray(s.characters) ? s.characters : []).forEach((c) => { const n = canon(c, chars); if (n) tags.push('char:' + n); });
  (Array.isArray(s.objects) ? s.objects : []).forEach((o) => { const n = canon(o, objs); if (n) tags.push('obj:' + n); });
  const tod = String(s.time_of_day || '').trim().toLowerCase(); if (TOD.includes(tod)) tags.push('tod:' + tod);
  const fields = {
    'Durată Scenă (secunde)': (Number.isFinite(dur) && dur >= 2 && dur <= 8) ? dur : 3,
    'Script Scenă': silent ? '' : line,
    'Prompt Vizual': String(s.visual_scene_description || ''),
    'Imagine First Frame': String(s.image_prompt || ''),
    'Video Scenă URL': String(s.video_motion_prompt || ''),
    'Aprobare Scenă': false,
    'Aprobare Voce': prep.cinematic === true || silent,
    'Status Producție Scenă': 'Generare Script',
    'Project_ID': pid,
    'Ordine Scenă': i + 1,
    'Evidence Ref': '',
    'Needs Fact Check': false,
    'Tag-uri Scenă': tags,
  };
  if (prep.hookChapterId) fields['Capitol'] = [prep.hookChapterId];
  items.push({ sql: 'select id from hov.at_create(' + q('scene') + ', ' + q(JSON.stringify(fields)) + '::jsonb)' });
});
const plan = {
  style: hook.style,
  silent: hook.silent,
  beats: hook.beats,
  card: hook.card,
  chosenBy: prep.wanted !== 'auto' ? 'producer' : (prep.forced ? 'default' : 'ai'),
  writtenAt: new Date().toISOString(),
};
items.push({ sql: 'update hov.project set editing_options = coalesce(editing_options, ' + q('{}') + '::jsonb) || ' + q(JSON.stringify({ hookPlan: plan, hookRegen: null, hookStyle: prep.wanted })) + '::jsonb where id = ' + q(pid) });
console.log('HOOK REGEN [' + hook.style + ']: ' + scenes.length + ' shots replace ' + (prep.oldHookSceneIds || []).length + ' on ' + pid);
return items.map((it) => ({ json: it }));
