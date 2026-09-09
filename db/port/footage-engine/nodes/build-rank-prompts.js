// Stage 2: one model call per batch of 8 scenes, each with its candidates — already ranked by the
// site's footage engine, which also says what each one IS (score, provenance, usage class).
// The model judges relevance on top of that; it does not rediscover it. Always at least one item.
const res = $json;
const scenes = Array.isArray(res.scenes) ? res.scenes : [];
const orig = $('Build Query Prompt').first().json.scenes || [];
const narr = {};
for (const s of orig) narr[s.id] = s.narration;
const RANK = 'You are choosing real footage for the scenes of a documentary. For EACH scene you get its narration and a list of candidate assets from public archives and official media services (id, provider, type, length, kind of shot, title, description, filming date or years mentioned, place, event), each with the engine\'s own relevance score (0-100), its provenance and its rights class. Provenance: actual_footage = the provider\'s metadata says it shows this event at this date and place; illustrative_footage = real material of the period or subject, not proven to be this event; archival_footage, archival_photo, real_stock = real, not dated against the scene. Pick only candidates that genuinely show the scene\'s subject at the right period. Reject museum replicas, modern re-enactments or reconstructions, unrelated subjects, the wrong decade, the wrong country, and generic images when the scene is about something specific. The catalogue date is often the upload date, not the event — trust the filming date, title, description and years mentioned. Under narration prefer B-roll and stockshots; a press conference, speech or interview only when the scene quotes that person. Prefer video over photos when both are equally relevant. Do not rank a candidate above one with a higher engine score unless the text gives a concrete reason. Up to 4 picks per scene, best first; zero picks is a valid answer. Answer ONLY with JSON: {"scenes":[{"id":"<scene id>","picks":[{"id":"<candidate id>","relevance":<0..1>,"reason":"<12 words, plain English>"}]}]}';
const withC = scenes.filter((s) => Array.isArray(s.candidates) && s.candidates.length);
if (!withC.length) {
  return [{ json: { payload: { model: 'gpt-5.4', response_format: { type: 'json_object' }, messages: [ { role: 'system', content: RANK }, { role: 'user', content: 'No scenes and no candidates. Answer {"scenes":[]}.' } ] }, candidates: {} } }];
}
const batches = [];
for (let i = 0; i < withC.length; i += 8) batches.push(withC.slice(i, i + 8));
return batches.map((batch) => {
  const text = batch.map((s) => {
    const lines = s.candidates.map((c) => {
      const when = c.filmingDate ? 'filmed ' + c.filmingDate
        : (c.yearsMentioned && c.yearsMentioned.length ? 'mentions ' + c.yearsMentioned.join(', ')
        : (c.dateOriginal ? 'catalogue date ' + c.dateOriginal : 'undated'));
      const bits = [
        `${c.id} [${c.provider || 'archive'} · ${c.mediaType}${c.durationSeconds ? ' ' + c.durationSeconds + 's' : ''}${c.footageFormat && c.footageFormat !== 'unknown' ? ' · ' + c.footageFormat : ''}]`,
        `"${c.title}" — ${c.description || ''}`,
        when,
        c.location ? 'place: ' + c.location : null,
        c.eventName ? 'event: ' + c.eventName : null,
        `score ${c.score == null ? '?' : c.score}/100 · ${c.provenance || 'unknown'} · ${c.usage || c.license || 'rights unknown'}`,
      ].filter(Boolean);
      return '  - ' + bits.join(' — ');
    }).join('\n');
    return `SCENE ${s.id}\nNARRATION: ${String(narr[s.id] || '').slice(0, 400)}\nCANDIDATES:\n${lines}`;
  }).join('\n\n');
  const candidates = {};
  for (const s of batch) candidates[s.id] = s.candidates.map((c) => c.id);
  return { json: { payload: { model: 'gpt-5.4', response_format: { type: 'json_object' }, messages: [ { role: 'system', content: RANK }, { role: 'user', content: text } ] }, candidates } };
});
