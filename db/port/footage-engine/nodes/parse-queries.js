// Strict: only scenes the model answered for count as PROCESSED; the rest keep their claim and expire.
// The request is sanitised HERE, not trusted: the site rebuilds it through buildFootageRequest, but a
// model can hand back the wrong types, and a stray object in `people` must not reach the engine.
// A date the model invents cannot be caught by code — the prompt forbids it and the engine only ever
// PENALISES a mismatch it can see, so a wrong date costs a candidate, never a scene.
const asked = $('Build Query Prompt').first().json;
const scenesIn = asked.scenes || [];
let raw = $json && $json.choices && $json.choices[0] && $json.choices[0].message ? $json.choices[0].message.content : '';
raw = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
let parsed = null;
try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.scenes) ? parsed.scenes : null);
if (!arr) return [{ json: { scenes: [], processed: [], error: 'model answer not parseable', raw: raw.slice(0, 300) } }];
const str = (v, max) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  return s ? s.slice(0, max) : null;
};
const strs = (v, max, n) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);
const date = (v) => { const s = str(v, 10); return s && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : null; };
const out = [];
const processed = [];
for (const row of arr) {
  const i = Number(row && row.i);
  const s = scenesIn[i - 1];
  if (!s) continue;
  processed.push(s.id);
  const queries = strs(row.queries, 120, 6).filter((q) => q.length >= 2);
  if (row.archive !== true || !queries.length) continue;
  const rq = row.request && typeof row.request === 'object' ? row.request : {};
  const years = Array.isArray(row.years) ? row.years : [];
  const ft = str(rq.preferredFootageType, 20);
  const request = {
    topic: str(rq.topic, 80),
    event: str(rq.event, 120),
    location: str(rq.location, 120),
    country: str(rq.country, 60),
    dateFrom: date(rq.dateFrom) || date(years[0]),
    dateTo: date(rq.dateTo) || date(years[1]) || date(rq.dateFrom) || date(years[0]),
    people: strs(rq.people, 80, 6),
    organizations: strs(rq.organizations, 80, 6),
    keywords: strs(rq.keywords, 40, 8),
    preferredMediaType: rq.preferredMediaType === 'image' ? 'image' : 'video',
    // "any" is left to the engine, which reads the narration for a quoted speaker.
    preferredFootageType: ['broll', 'stockshots', 'speech', 'interview'].includes(ft) ? ft : null,
    requireExactEvent: rq.requireExactEvent === true,
  };
  out.push({ id: s.id, request, queries, why: str(row.why, 120) || '' });
}
console.log(`archive suggest: ${scenesIn.length} scenes, ${out.length} want real footage, ${processed.length} processed`);
return [{ json: { scenes: out, processed, count: scenesIn.length } }];
