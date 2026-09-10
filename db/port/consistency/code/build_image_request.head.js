const f = $json.fields || {};
const prompt = f['Imagine First Frame'] || f['Prompt Vizual'] || '';
if (!prompt) throw new Error('Scene ' + $json.id + ' has no image prompt.');
const rb = $('Receive Batch Input').first().json;
const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';
// Images are generated ON Google Flow (useapi POST /google-flow/images); the
// response carries the fifeUrl the ingest re-hosts and the mediaGenerationId
// Submit Video needs. One model string, here, in the gate's regen and in
// Claude Scripting's IR Build Request — the three must agree.
const MODEL = 'nano-banana-2';

// The project as read at pass start, plus whatever THIS pass stored after that
// read (the user photo id, the cast sheets, the set plates).
const projF = ($('IMG Load Project').first().json.fields || {});
let opts = {}; try { opts = JSON.parse(projF['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }
let bible = {}; try { bible = JSON.parse(projF['Story Bible'] || '{}') || {}; } catch (e) { bible = {}; }
try { if ($('Save User Ref Id').isExecuted) { const m = $('Save User Ref Id').first().json.media_id; if (m) opts.refImageMediaId = String(m); } } catch (e) {}
try { if ($('Save Cast Refs').isExecuted) { const j = $('Save Cast Refs').first().json; if (j.cast_refs) opts.castRefs = j.cast_refs; if (j.cast_sheets) opts.castSheets = j.cast_sheets; if (j.object_refs) opts.objectRefs = j.object_refs; } } catch (e) {}
try { if ($('Save Set Plates').isExecuted) { const j = $('Save Set Plates').first().json; if (j.location_refs) opts.locationRefs = j.location_refs; } } catch (e) {}
const userRefId = String(opts.refImageMediaId || '');
const isFirstScene = Number(f['Ordine Scenă']) === 1;

// n-1 chain: the previous scene's generated image, BY ITS FLOW MEDIA ID, read
// from the previous run of Decode Scene Image (run data survives Wait
// suspensions, unlike static data in test executions — execution 661).
let prevId = '';
let prevPrompt = '';
try {
  if ($runIndex > 0) {
    const prev = $('Decode Scene Image').all(0, $runIndex - 1);
    if (prev && prev[0] && prev[0].json && prev[0].json.mediaId) prevId = prev[0].json.mediaId;
    const prevReq = $('Build Image Request').all(0, $runIndex - 1);
    if (prevReq && prevReq[0] && prevReq[0].json) prevPrompt = prevReq[0].json.rawPrompt || '';
  }
} catch (e) { prevId = ''; }
// Similarity guard, unchanged: near-identical consecutive prompts keep the
// subject consistent by text alone; the reference would collapse the
// composition (the Porsche films). Sheets and plates are NOT subject to it —
// they carry identity and place, not layout.
const wordSet = (s) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 3));
let promptSim = 0;
if (prevPrompt) {
  const A = wordSet(prompt), B = wordSet(prevPrompt);
  if (A.size && B.size) { let hit = 0; for (const w of A) if (B.has(w)) hit++; promptSim = hit / Math.max(A.size, B.size); }
}
if (promptSim > 0.55) prevId = '';
const afterRefusal = /AUTO-REWRITE/.test(String(f['Observații Scenă'] || ''));

// A consistency re-roll (Judge Verdict sent this scene back) tightens the
// wording and carries the judge's reasons; counted per scene per pass.
const sd = $getWorkflowStaticData('global');
sd.consistencyRerolls = sd.consistencyRerolls || {};
sd.consistencyNotes = sd.consistencyNotes || {};
const strict = (sd.consistencyRerolls[$json.id] || 0) > 0;
const strictNotes = strict ? String(sd.consistencyNotes[$json.id] || '') : '';
