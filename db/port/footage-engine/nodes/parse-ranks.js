// A pick must name a candidate the batch actually offered — a model can misquote an id.
// The cap is the third copy of MAX_PICKS_PER_SCENE: the site's store stage and the rank
// prompt above carry the same number, and it is a sanity bound on a table and a prompt,
// not a number of options anyone chose. It was FOUR here until 2026-09-13, which is how
// a scene with a clip and three photographs offered the producer four photographs.
const items = $input.all();
const built = $('Build Rank Prompts').all();
const scenes = [];
items.forEach((it, idx) => {
  const allowed = (built[idx] && built[idx].json.candidates) || {};
  let raw = it.json && it.json.choices && it.json.choices[0] && it.json.choices[0].message ? it.json.choices[0].message.content : '';
  raw = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { return; }
  const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.scenes) ? parsed.scenes : []);
  for (const s of arr) {
    const id = String((s && s.id) || '');
    const ok = allowed[id];
    if (!ok) continue;
    const picks = (Array.isArray(s.picks) ? s.picks : [])
      .filter((p) => p && ok.includes(String(p.id)))
      .slice(0, 16)
      .map((p) => ({ id: String(p.id), relevance: Number.isFinite(Number(p.relevance)) ? Math.max(0, Math.min(1, Number(p.relevance))) : null, reason: String(p.reason || '').slice(0, 300) }));
    scenes.push({ id, picks });
  }
});
console.log(`archive suggest: ${scenes.length} scenes ranked, ${scenes.reduce((n, s) => n + s.picks.length, 0)} picks`);
return [{ json: { scenes } }];
