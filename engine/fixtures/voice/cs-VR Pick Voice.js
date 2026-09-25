// Same voice rules as AB Pick Voice in Media Generation — chapters mode
// picks the chapter's narrator, characters mode splits the text into tagged
// segments, everything else keeps the project narrator.
const pf = ($('VR Load Project').first().json || {}).fields || {};
const pv = String(pf['Voice ID'] || '');
const fallback = pv.includes('_') ? pv : 'elevenlabs_hpp4J3VqNfWAUOO0d1Us';
let voice = fallback, mode = 'off', cast = [], assign = {}, chapterVoices = {};
try {
  const opts = JSON.parse(pf['Editing Options'] || '{}') || {};
  mode = String(opts.multiVoiceMode || 'off');
  cast = (Array.isArray(opts.cast) ? opts.cast : []).filter(v => typeof v === 'string' && v.includes('_'));
  assign = (opts.castAssign && typeof opts.castAssign === 'object') ? opts.castAssign : {};
  // Explicit per-chapter narrators picked in the audio panel; the key is
  // the chapter number as a string, plus 'hook' for the opening scene.
  chapterVoices = (opts.chapterVoices && typeof opts.chapterVoices === 'object') ? opts.chapterVoices : {};
} catch (e) {}
const f = $('VR Load Scene').first().json.fields || {};
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
  const all = (($('VR Load All Scenes').first().json || {}).records || [])
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
  multi = segments.length > 0 && segments.some(s => s.voice_id !== fallback);
}
return [{ json: { voice_id: voice, multi, segments } }];
