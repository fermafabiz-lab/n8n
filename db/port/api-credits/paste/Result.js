// What the webhook answers (responseMode: lastNode): the readings just taken
// and whether they were saved. The site shows them straight away instead of
// re-reading the table, so Refresh still says something useful on a database
// where db/015 has not been applied.
const n = $('Normalize').first().json;
let saved = true;
let saveError = null;
try {
  const w = $('Save Snapshot').first().json;
  if (w && w.error) {
    saved = false;
    saveError = String((w.error && w.error.message) || w.error).slice(0, 300);
  }
} catch (e) {
  saved = false;
  saveError = 'The write did not run.';
}
return [{ json: { ok: true, takenAt: n.takenAt, source: n.source, saved, saveError, readings: n.readings } }];
