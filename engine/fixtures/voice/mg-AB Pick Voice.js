// Which voice (or voices) read this scene.
// - 'chapters': the chapter's narrator — an explicit pick from the audio
//   panel, else cast[N-1] (looping); the hook keeps the main narrator
//   unless it was given a voice of its own.
// - 'characters': the scene text carries [NARRATOR]/[CHARACTER: Name] tags;
//   it is split into segments, each with its speaker's voice. Characters
//   are assigned voices by explicit castAssign (set in the audio panel) or,
//   failing that, by first appearance across the whole project — the same
//   deterministic rule the site shows.
// - anything else: the project narrator, exactly the pre-multi-voice logic.
const rb = $('Receive Batch Input').first().json;
const fallback = ((rb.Voice_ID || '').includes('_')) ? rb.Voice_ID : 'elevenlabs_hpp4J3VqNfWAUOO0d1Us';
let voice = fallback, mode = 'off', cast = [], assign = {}, chapterVoices = {};
try {
  const pf = $('AB Load Project').first().json.fields || {};
  const opts = JSON.parse(pf['Editing Options'] || '{}') || {};
  mode = String(opts.multiVoiceMode || 'off');
  cast = (Array.isArray(opts.cast) ? opts.cast : []).filter(v => typeof v === 'string' && v.includes('_'));
  assign = (opts.castAssign && typeof opts.castAssign === 'object') ? opts.castAssign : {};
  // Explicit per-chapter narrators picked in the audio panel; the key is
  // the chapter number as a string, plus 'hook' for the opening scene.
  chapterVoices = (opts.chapterVoices && typeof opts.chapterVoices === 'object') ? opts.chapterVoices : {};
} catch (e) {}
const f = $('AB Current Scene').first().json.fields || {};
const text = String(f['Script Scenă'] || '');
if (mode === 'chapters' && (cast.length || Object.keys(chapterVoices).length)) {
  const o = Number(f['Ordine Scenă']);
  const chapter = Number.isFinite(o) ? Math.floor(o / 100) : 0;
  // An explicit pick always wins — including for the hook, which has
  // no position in the cast and otherwise keeps the main narrator.
  const picked = chapterVoices[chapter > 0 ? String(chapter) : 'hook'];
  if (typeof picked === 'string' && picked.includes('_')) voice = picked;
  else if (chapter > 0 && cast.length) voice = cast[(chapter - 1) % cast.length];
}
let multi = false, segments = [];
if (mode === 'characters' && cast.length) {
  const all = $('Refetch Scenes For Audio').all().map(s => s.json)
    .sort((a, b) => (Number((a.fields || {})['Ordine Scenă']) || 0) - (Number((b.fields || {})['Ordine Scenă']) || 0));
  const order = [];
  for (const sc of all) {
    const t = String((sc.fields || {})['Script Scenă'] || '');
    for (const m of t.matchAll(/\[\s*CHARACTER:\s*([^\]]+)\]/gi)) {
      const n = m[1].trim();
      if (n && !order.includes(n)) order.push(n);
    }
  }
  const voiceFor = (name) => {
    const a = assign[name];
    if (typeof a === 'string' && a.includes('_')) return a;
    const i = order.indexOf(name);
    return cast[(i >= 0 ? i : 0) % cast.length];
  };
  let cur = fallback;
  for (const tk of text.split(/(\[[^\[\]]{1,60}\])/)) {
    if (/^\[\s*NARRATOR\s*\]$/i.test(tk)) { cur = fallback; continue; }
    const cm = tk.match(/^\[\s*CHARACTER:\s*([^\]]+)\]$/i);
    if (cm) { cur = voiceFor(cm[1].trim()); continue; }
    const t = tk.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const last = segments[segments.length - 1];
    if (last && last.voice_id === cur) last.text += ' ' + t;
    else segments.push({ text: t, voice_id: cur });
  }
  // Only worth the multi pipeline when a second voice actually appears.
  multi = segments.length > 0 && segments.some(s => s.voice_id !== fallback);
}
return [{ json: { voice_id: voice, multi, segments } }];
