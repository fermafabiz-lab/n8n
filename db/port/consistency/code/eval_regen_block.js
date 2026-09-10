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
    const rejected = /^(AUTO-REWRITE|REJECTED|Image regeneration REJECTED)/i.test(feedback);
    if (rejected) feedback = '';
    let prompt = f['Imagine First Frame'] || f['Prompt Vizual'] || '';
    if (feedback) prompt += '\n\nADJUSTMENT REQUEST — the new image MUST follow this: ' + feedback;
    const planned = CONS.plan({ f: f, opts: regenOpts, bible: regenBible, prompt: prompt, prevId: prevId, userRefId: '', isFirstScene: false, afterRefusal: rejected, strict: false, strictNotes: '' });
    const requestBody = CONS.apply({ email: 'fermafabiz@gmail.com', model: 'nano-banana-2', prompt: prompt, aspectRatio: regenAspect, count: 1, captchaRetry: 1 }, planned);
    regen.push({ id: r.json.id, prompt, prevId, requestBody, refs: planned.refs });
  }
});
