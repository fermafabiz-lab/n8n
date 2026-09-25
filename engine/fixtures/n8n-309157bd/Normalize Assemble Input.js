// Website/manual retrigger path: accept {Project_ID, aspect?, captions?} in
// the POST body and hand downstream the same shape the sub-workflow trigger
// gives.
const b = $json.body || {};
const id = b.Project_ID || b.project_id || '';
if (!id) throw new Error('Project_ID missing in webhook body');
return [{ json: {
  Project_ID: id,
  Aspect: b.aspect === '9:16' ? '9:16' : (b.aspect || ''),
  No_Captions: (b.captions === 'no' || b.no_captions === true) ? 'yes' : '',
} }];