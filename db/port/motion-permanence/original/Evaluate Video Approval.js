const expected = $('Sort & Cap Scenes').all().map(s => s.json.id);
const order = {};
expected.forEach((id, i) => order[id] = i);
const seen = new Set();
const recs = $input.all()
  .filter(r => order[r.json.id] !== undefined)
  .filter(r => { if (seen.has(r.json.id)) return false; seen.add(r.json.id); return true; })
  .slice()
  .sort((a, b) => order[a.json.id] - order[b.json.id]);
// One regen per polling cycle: keeps the submit->poll->mux chain simple and
// avoids splitInBatches re-entry problems. Remaining flags are picked up on
// the next 15s cycle automatically.
let regen = null;
for (const r of recs) {
  const f = r.json.fields || {};
  if (f['Regenerează Video'] === true) {
    const feedback = String(f['Observații Scenă'] || '').trim();
    let motionPrompt = f['Video Scenă URL'] || '';
    if (feedback) motionPrompt += ' ADJUSTMENT REQUEST — the new video MUST follow this: ' + feedback + '.';
    regen = { id: r.json.id, motionPrompt, imageId: f['Image Media ID'] || '', voiceUrl: f['Voiceover URL'] || '' };
    break;
  }
}
// Voice-only regeneration (site button): new TTS from the (possibly edited)
// narration, re-muxed onto the EXISTING clip — no image/video redo.
let voiceRegen = null;
for (const r of recs) {
  const f = r.json.fields || {};
  if (f['Regenerează Voce'] === true) {
    voiceRegen = {
      id: r.json.id,
      text: String(f['Script Scenă'] || '').trim(),
      clipUrl: String(f['Scene Final URL'] || ''),
    };
    break;
  }
}
const total = recs.length;
// A scene only counts as approved if its muxed clip actually exists —
// bulk-approving before generation finished must not open the gate.
const approved = recs.filter(r => { const f = r.json.fields || {}; return f['Aprobare Video'] === true && String(f['Scene Final URL'] || '').startsWith('http'); }).length;
return [{ json: { anyRegen: !!regen, anyVoiceRegen: !!voiceRegen, allApproved: total > 0 && approved === total, regen, voiceRegen, total, approved } }];
