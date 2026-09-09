// Stage 1: which scenes want real footage, and WHAT each one needs — a structured
// request the site's Universal Footage Engine routes to the right archives, plus
// short catalogue queries. Always emits ONE item with a valid payload, even for
// zero scenes — the HTTP node after it runs unconditionally.
const b = $json;
const scenes = Array.isArray(b.scenes) ? b.scenes.slice(0, 120) : [];
const p = b.project || {};
const SYSTEM = [
  'You are an archive researcher for a documentary film. For EACH scene decide whether REAL footage or photographs — from public archives and official media services (Wikimedia Commons; the EU Audiovisual Service for European politics, institutions and migration; DVIDS for military, humanitarian and disaster-response operations; NASA for space, science and aviation) — would serve the scene better than a generated picture. Real material suits scenes about identifiable real people, events, places, objects, machines, institutions or dated periods that were actually photographed or filmed, recent news events included. It does NOT suit abstract or emotional beats, metaphors, fiction, dramatised re-enactments, generic present-day illustration, or shots that need a specific composition matching the neighbouring generated scenes.',
  'For each suitable scene describe WHAT it needs, using only facts the script states or clearly implies — never invent a date, a place, a person or an event the narration does not support; leave the field null instead.',
  'request fields: topic (2-5 words); event (the specific named event, else null); location and country (else null); dateFrom and dateTo (ISO dates or years, else null); people and organizations (names present in the narration, else []); keywords (3-8 English catalogue words); preferredMediaType ("video" or "image"); preferredFootageType ("broll" for narration over pictures, "speech" or "interview" when the scene quotes a person speaking, "any" otherwise); requireExactEvent (true only when the scene is ABOUT a specific dated event and generic pictures would mislead).',
  'queries: 3-6 SHORT English catalogue queries (proper names, event, place, year — like "Ceuta border crossing May 2026" or "Ford Model T assembly line"), never full sentences, most specific first.',
  'Answer ONLY with JSON: {"scenes":[{"i":<1-based index>,"archive":true|false,"why":"<10 words>","request":{...},"queries":[...]}]}, one object per scene, in order; for archive:false the request may be omitted.',
].join('\n');
const list = scenes.length
  ? scenes.map((s, i) => `${i + 1}. ${String(s.narration || '').replace(/\s+/g, ' ').slice(0, 400)}${s.visual ? ' — visual: ' + String(s.visual).replace(/\s+/g, ' ').slice(0, 200) : ''}`).join('\n')
  : '(no scenes)';
const user = `FILM: ${p.name || ''}\nLANGUAGE: ${p.language || ''}\n${p.brief ? 'BRIEF: ' + String(p.brief).slice(0, 1200) + '\n' : ''}\nSCENES:\n${list}`;
const payload = { model: 'gpt-5.4', response_format: { type: 'json_object' }, messages: [ { role: 'system', content: SYSTEM }, { role: 'user', content: user } ] };
return [{ json: { payload, scenes, project: p, count: scenes.length } }];
