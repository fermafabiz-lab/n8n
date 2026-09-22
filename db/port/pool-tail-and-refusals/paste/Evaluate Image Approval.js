// ---------------------------------------------------------------------------
// REFERENCE ASSEMBLY — shared word for word by Build Image Request (batch),
// Evaluate Image Approval (the gate's regen) and IR Build Request (the site's
// regen). Change one, change all three: a re-rolled picture built from
// different references than its neighbours is the drift this exists to stop.
//
// Consistency comes from PICTURES the model is anchored to, never from prose:
//   - cast sheets   (castRefs / castSheets)   one per character, turnaround or portrait
//   - object sheets (objectRefs)              one per hero object (a car, a machine)
//   - set plates    (locationRefs)            one per bible location, wide, empty
//   - the producer's own photo                ground truth on scene 1
//   - the previous frame                      LAST, palette only
// Who and where come from the scene's own tags (`char:`, `obj:`, `loc:`),
// written by the segmenter; films made before the tags existed fall back to
// name matching on Prompt Vizual, exactly as the cast sheet did.
const CONS = (function () {
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagsOf = (f) => (Array.isArray(f['Tag-uri Scenă']) ? f['Tag-uri Scenă'] : []).map((t) => String(t));
  const tagged = (f, prefix) => tagsOf(f).filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length).trim()).filter(Boolean);
  const mentions = (text, name, allGivens) => {
    const full = norm(name);
    const given = norm(name.split(/\s+/)[0] || '');
    const keys = (allGivens || []).filter((g) => g && g === given).length > 1 ? [full] : [full, given];
    return keys.some((k) => k.length > 2 && new RegExp('\\b' + esc(k) + '\\b').test(text));
  };
  // Which bible entries are IN this scene: tags first (exact names the
  // segmenter chose from the bible), name matching second.
  function present(f, entries, prefix, textFields) {
    const names = entries.map((e) => String((e || {}).name || '').trim()).filter(Boolean);
    const fromTags = tagged(f, prefix).map(norm);
    if (fromTags.length) return names.filter((n) => fromTags.includes(norm(n)));
    const text = ' ' + norm(textFields.map((k) => f[k] || '').join(' ')) + ' ';
    const givens = names.map((n) => norm(n.split(/\s+/)[0] || ''));
    return names.filter((n) => mentions(text, n, givens));
  }
  function plan(a) {
    // a: { f, opts, bible, prompt, prevId, userRefId, isFirstScene, afterRefusal, strict, strictNotes }
    const opts = a.opts || {}, bible = a.bible || {}, f = a.f || {};
    const castRefs = (opts.castRefs && typeof opts.castRefs === 'object') ? opts.castRefs : {};
    const castSheets = (opts.castSheets && typeof opts.castSheets === 'object') ? opts.castSheets : {};
    const objectRefs = (opts.objectRefs && typeof opts.objectRefs === 'object') ? opts.objectRefs : {};
    const locationRefs = (opts.locationRefs && typeof opts.locationRefs === 'object') ? opts.locationRefs : {};
    const chars = Array.isArray(bible.characters) ? bible.characters : [];
    const objs = Array.isArray(bible.objects) ? bible.objects : [];
    const locs = Array.isArray(bible.locations) ? bible.locations : [];
    const refs = []; // {id, role, name}
    const used = { cast: [], objects: [], location: '', user: false, palette: false };
    if (a.afterRefusal) {
      // A refusal is likeliest about a face; nothing is attached, the prompt
      // rewrite alone carries the retry. Same rule as before the sheets.
      return { refs, used, prompt: a.prompt };
    }
    const protagonist = (() => {
      const byRole = chars.find((c) => /protagonist|lead|main|hero/i.test(String((c || {}).role || '')));
      return String(((byRole || chars[0]) || {}).name || '');
    })();
    if (a.isFirstScene && a.userRefId) { refs.push({ id: a.userRefId, role: 'user', name: protagonist }); used.user = true; }
    // Cast: leads (turnaround sheets) first, then portraits; two at most —
    // a third sheet crowds the composition (measured on the cast sheet port).
    const inScene = present(f, chars, 'char:', ['Prompt Vizual']).filter((n) => castRefs[n]);
    inScene.sort((x, y) => ((castSheets[y] || {}).kind === 'turnaround') - ((castSheets[x] || {}).kind === 'turnaround'));
    for (const n of inScene) {
      if (used.user && norm(n) === norm(protagonist)) continue; // the photo is truer than the sheet
      if (used.cast.length >= 2) break;
      refs.push({ id: castRefs[n], role: 'cast', name: n }); used.cast.push(n);
    }
    const objsIn = present(f, objs, 'obj:', ['Prompt Vizual', 'Imagine First Frame']).filter((n) => objectRefs[n]);
    for (const n of objsIn) { if (used.objects.length >= 1) break; refs.push({ id: objectRefs[n], role: 'object', name: n }); used.objects.push(n); }
    const locIn = present(f, locs, 'loc:', ['Prompt Vizual', 'Imagine First Frame']).filter((n) => locationRefs[n]);
    if (locIn.length) { refs.push({ id: locationRefs[locIn[0]], role: 'place', name: locIn[0] }); used.location = locIn[0]; }
    // The previous frame, last, palette only — and only when there is room.
    if (a.prevId && refs.length < 5 && !refs.some((r) => r.id === a.prevId)) { refs.push({ id: a.prevId, role: 'palette', name: '' }); used.palette = true; }
    // The sentence names the references BY POSITION, so it is built from the
    // list rather than assumed.
    const parts = [];
    refs.forEach((r, i) => {
      const k = i + 1;
      if (r.role === 'user') parts.push('Reference image ' + k + ' is the producer\'s own photo and is GROUND TRUTH for that character: exactly the same face, hair, body and outfit.');
      else if (r.role === 'cast') parts.push('Reference image ' + k + ' is a character sheet of ' + r.name + ' shown from several angles: this character (a person, an animal or a creature, whatever the sheet shows) in the shot has EXACTLY that face or head, hair or markings, colours, build and wardrobe. Render ONE view of them inside the scene — never the sheet layout, never several copies, never the neutral backdrop.');
      else if (r.role === 'object') parts.push('Reference image ' + k + ' is a reference sheet of ' + r.name + ': the same object in the shot has exactly that design, colours, markings and materials — one instance, placed in the scene.');
      else if (r.role === 'place') parts.push('Reference image ' + k + ' is the PLACE (' + r.name + '): the same architecture, layout, landmarks, materials and the same arrangement of what stands where. Light, weather and time of day follow the text, not the plate; the plate is empty of people and its framing is not this shot\'s framing.');
      else if (r.role === 'palette') parts.push('The LAST reference image is only for colour palette and film look, never for layout and never for who or where anyone is.');
    });
    let prompt = a.prompt;
    if (parts.length) {
      prompt = parts.join(' ') + ' Compose the shot described here, which may place its subjects at any distance, angle or part of the location: ' + a.prompt;
      if (a.strict) prompt = 'STRICT MATCH — the previous attempt drifted from the references (' + String(a.strictNotes || 'identity or place did not match') + '). Wherever the text and the references disagree about how a person, object or place LOOKS, the references win. ' + prompt;
    }
    return { refs, used, prompt };
  }
  function apply(body, planned) {
    planned.refs.forEach((r, i) => { body['reference_' + (i + 1)] = r.id; });
    body.prompt = planned.prompt;
    return body;
  }
  return { norm, plan, apply, tagged };
})();
// ---------------------------------------------------------------------------
const expected = $('Sort & Cap Scenes').all().map(s => s.json.id);
const order = {};
expected.forEach((id, i) => order[id] = i);
const seen = new Set();
const recs = $input.all()
  .filter(r => order[r.json.id] !== undefined)
  .filter(r => { if (seen.has(r.json.id)) return false; seen.add(r.json.id); return true; })
  .slice()
  .sort((a, b) => order[a.json.id] - order[b.json.id]);
const regen = [];
// The gate's regen builds the SAME reference set the batch loop builds —
// sheets, object sheets, the set plate, the previous scene's picture last —
// through the shared assembler below, so a re-rolled picture is anchored
// exactly like its neighbours. After a REJECTED / AUTO-REWRITE note nothing
// is attached (the reference may hold what was refused).
const projF = ($('IMG Load Project').first().json.fields || {});
let regenOpts = {}; try { regenOpts = JSON.parse(projF['Editing Options'] || '{}') || {}; } catch (e) { regenOpts = {}; }
let regenBible = {}; try { regenBible = JSON.parse(projF['Story Bible'] || '{}') || {}; } catch (e) { regenBible = {}; }
try { if ($('Save Cast Refs').isExecuted) { const j = $('Save Cast Refs').first().json; if (j.cast_refs) regenOpts.castRefs = j.cast_refs; if (j.cast_sheets) regenOpts.castSheets = j.cast_sheets; if (j.object_refs) regenOpts.objectRefs = j.object_refs; } } catch (e) {}
try { if ($('Save Set Plates').isExecuted) { const j = $('Save Set Plates').first().json; if (j.location_refs) regenOpts.locationRefs = j.location_refs; } } catch (e) {}
const regenAspect = ($('Receive Batch Input').first().json.Aspect_Ratio === '9:16' ? '9:16' : '16:9');
recs.forEach((r, i) => {
  const f = r.json.fields || {};
  if (f['Regenerează Imagine'] === true) {
    const prevId = i > 0 ? String(((recs[i-1].json.fields || {})['Image Media ID']) || '') : '';
    let feedback = String(f['Observații Scenă'] || '').trim();
    const rejected = /^(AUTO-|REJECTED|Image regeneration REJECTED)/i.test(feedback);
    if (rejected) feedback = '';
    let prompt = f['Imagine First Frame'] || f['Prompt Vizual'] || '';
    if (feedback) prompt += '\n\nADJUSTMENT REQUEST — the new image MUST follow this: ' + feedback;
    const planned = CONS.plan({ f: f, opts: regenOpts, bible: regenBible, prompt: prompt, prevId: prevId, userRefId: '', isFirstScene: false, afterRefusal: rejected, strict: false, strictNotes: '' });
    const requestBody = CONS.apply({ email: 'fermafabiz@gmail.com', model: 'nano-banana-2', prompt: prompt, aspectRatio: regenAspect, count: 1, captchaRetry: 1 }, planned);
    regen.push({ id: r.json.id, prompt, prevId, requestBody, refs: planned.refs });
  }
});
const total = recs.length;
// This is the COMBINED asset gate. Takes and images are generated in one
// uninterrupted pass (audio loop first, image loop second) and reviewed
// together here, so the producer makes one visit instead of two before the
// expensive video stage. Voice regeneration is NOT dispatched from here —
// the standalone scene-voice-regen webhook covers it, exactly as it covered
// the old separate voice gate. Image regeneration keeps its in-batch chain
// (If Any Regen).
//
// A scene only counts as approved when its asset actually EXISTS — bulk
// approving before generation finished must not open the gate.
const imagesApproved = recs.filter(r => {
  const f = r.json.fields || {};
  const att = f['Imagine Scenă'];
  return f['Aprobare Imagine'] === true && Array.isArray(att) && att.length > 0;
}).length;
// Cinematic (silent) projects never synthesize: the pre-checked Aprobare
// Voce alone passes. AB Load Project runs whenever any scene lacked audio
// this pass; when it never ran (every scene already voiced) the catch
// leaves noSpeech false, which is correct for a project that has takes.
let noSpeech = false;
try { noSpeech = JSON.parse((($('AB Load Project').first().json.fields || {})['Editing Options']) || '{}').category === 'cinematic'; } catch (e) {}
const voicesApproved = recs.filter(r => {
  const f = r.json.fields || {};
  // A scene with NO narration at all (a silent hook shot — see Save scenes To
  // Airtable1's [SILENT] rule) never gets a take, so its approval cannot wait
  // for one; it is created approved, exactly like every scene of a silent film.
  const silentScene = String(f['Script Scenă'] || '').trim() === '';
  return f['Aprobare Voce'] === true && (noSpeech || silentScene || String(f['Voiceover URL'] || '') !== '');
}).length;
const allApproved = total > 0 && imagesApproved === total && voicesApproved === total;
return [{ json: { anyRegen: regen.length > 0, allApproved, regen, total, approved: imagesApproved, imagesApproved, voicesApproved } }];