let scenes = $input.all().slice();
const seen = new Set();
scenes = scenes.filter(s => { const id = s.json.id; if (!id || seen.has(id)) return false; seen.add(id); return true; });
scenes = scenes.filter(s => { const v = (s.json.fields || {})['Scene Final URL'] || ''; return v.startsWith('http'); });
const ord = it => { const f = it.json.fields || {}; return (typeof f['Ordine Scenă'] === 'number') ? f['Ordine Scenă'] : null; };
scenes.sort((a, b) => {
  const oa = ord(a), ob = ord(b);
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  const t = new Date(a.json.createdTime) - new Date(b.json.createdTime);
  if (t) return t;
  return a.json.id < b.json.id ? -1 : 1;
});
if (!scenes.length) throw new Error('No scenes with a final muxed clip (Scene Final URL) found for this project.');
return scenes.map((s, i) => {
  const o = ord(s);
  // Ordine Scenă = chapter*100 + scene (hook = 1 → chapter 0).
  const chapter = o !== null ? Math.floor(o / 100) : (i === 0 ? 0 : 1);
  return { json: {
    id: s.json.id,
    url: s.json.fields['Scene Final URL'],
    voiceUrl: s.json.fields['Voiceover URL'] || '',
    // Same strip as both TTS paths: speaker tags ([NARRATOR], [CHARACTER: X])
    // are routing, not narration — without this they showed up in captions.
    narratorText: String(s.json.fields['Script Scenă'] || '').replace(/\[[^\]]{0,60}\]\s*/g, ' ').replace(/\s+/g, ' ').trim(),
    chapter,
    order: o,
    // The planned length (3 or 6 on a hook shot, 8 elsewhere). Only the hook
    // reads it — Build Timeline turns it into holdSeconds for a silent shot.
    seconds: (typeof s.json.fields['Durată Scenă (secunde)'] === 'number') ? s.json.fields['Durată Scenă (secunde)'] : null,
  } };
});