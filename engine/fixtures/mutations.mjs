// Edits to the Rome world that between them reach every branch of every
// Final Assembly body. Each is (world) => void and mutates a deep copy.
// `eo` patches Editing Options the way the site stores it: a JSON string on
// the project row. A patch value of undefined deletes the key.

export function eo(world, patch) {
  const f = world.project.fields;
  const cur = JSON.parse(f['Editing Options'] || '{}');
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete cur[k]; else cur[k] = v; }
  f['Editing Options'] = JSON.stringify(cur);
}
const pf = (w) => w.project.fields;
const scene = (w, i) => w.sceneRows[i].fields;
const hook = (style) => ({ style, beats: ['One.', 'Two.'] });

export const mutations = {
  // trigger / aspect / captions
  'receive path, 16:9 trigger over a 9:16 project': (w) => { delete w.webhookBody; w.receive = { Project_ID: w.project.id, Aspect: '', No_Captions: '' }; pf(w).Format = '16:9'; },
  'receive path with No_Captions only (Props keeps it, Timeline falls through)': (w) => { w.receive = { Project_ID: w.project.id, Aspect: '', No_Captions: 'yes' }; w.webhookBody = { Project_ID: w.project.id, aspect: '9:16' }; pf(w).Format = '16:9'; pf(w)['Fără Subtitrări'] = false; },
  'receive 9:16 wins over the webhook': (w) => { w.receive = { Project_ID: w.project.id, Aspect: '9:16', No_Captions: '' }; pf(w).Format = '16:9'; },
  'webhook aspect 9:16, captions no': (w) => { w.webhookBody = { project_id: w.project.id, aspect: '9:16', captions: 'no' }; pf(w).Format = '16:9'; pf(w)['Fără Subtitrări'] = false; },
  'webhook odd aspect passes through, no_captions true': (w) => { w.webhookBody = { Project_ID: w.project.id, aspect: '4:3', no_captions: true }; },
  'project 16:9 with captions on': (w) => { pf(w).Format = '16:9'; pf(w)['Fără Subtitrări'] = false; },
  // categories
  'cinematic': (w) => { eo(w, { category: 'cinematic' }); pf(w)['Fără Subtitrări'] = false; },
  'kids relaxed': (w) => eo(w, { category: 'kids', categoryOptions: { narration_pace: 'slow' } }),
  'kids read-along': (w) => eo(w, { category: 'kids', categoryOptions: { narration_pace: 'very_slow' } }),
  'documentary (watermark on)': (w) => eo(w, { category: 'documentary' }),
  'documentary, watermark refused': (w) => eo(w, { category: 'documentary', sourceWatermark: false }),
  'category absent': (w) => eo(w, { category: undefined }),
  'category empty string': (w) => eo(w, { category: '' }),
  'category null': (w) => eo(w, { category: null }),
  // music
  'music off': (w) => eo(w, { music: undefined }),
  'music pinned': (w) => eo(w, { musicTrack: { id: '  pinned-123 ', name: 'Chosen' } }),
  'music pinned without a name': (w) => eo(w, { musicTrack: { id: 'pinned-9' } }),
  'music pinned blank id falls through': (w) => eo(w, { musicTrack: { id: '   ' } }),
  'music: no tone subfolder, tone-named loose file': (w) => { pf(w).Tonalitate = 'Epic'; w.rootFiles = [{ id: 'l1', name: 'epic-1.mp3', mimeType: 'audio/mpeg' }, { id: 'l2', name: 'default.mp3', mimeType: 'audio/mpeg' }, { id: 'f', name: 'Dark', mimeType: 'application/vnd.google-apps.folder' }]; },
  'music: default-named loose file': (w) => { pf(w).Tonalitate = 'Épique'; w.rootFiles = [{ id: 'l1', name: 'a.mp3' }, { id: 'l2', name: 'DEFAULT-2.mp3' }]; },
  'music: any loose file': (w) => { pf(w).Tonalitate = 'Calm'; w.rootFiles = [{ id: 'l1', name: 'a.mp3' }, { id: 'l2', name: 'b.mp3' }, { name: 'no-id.mp3' }]; },
  'music: Default subfolder fallback': (w) => { pf(w).Tonalitate = 'Mysterious'; w.rootFiles = [{ id: 'fd', name: 'Default', mimeType: 'application/vnd.google-apps.folder' }]; w.driveFolders = { fd: [{ id: 'x', name: 'x.mp3' }, { id: 'sub', name: 'nested', mimeType: 'application/vnd.google-apps.folder' }] }; },
  'music: no Tonalitate (first folder wins)': (w) => { delete pf(w).Tonalitate; },
  'music: empty folder': (w) => { w.rootFiles = []; w.driveFolders = {}; },
  // levels / resolution
  'sfx off': (w) => eo(w, { sfx: false }),
  'levels out of range': (w) => eo(w, { sfxLevel: 3, musicLevel: 0.01 }),
  'levels as strings, rounded': (w) => eo(w, { sfxLevel: '0.456', musicLevel: '0.3' }),
  'levels garbage': (w) => eo(w, { sfxLevel: 'loud', musicLevel: null }),
  '1080p': (w) => eo(w, { resolution: '1080p' }),
  // hook
  'no hookPlan': (w) => eo(w, { hookPlan: undefined }),
  'cliffhanger hook (riser)': (w) => eo(w, { hookPlan: hook('cliffhanger') }),
  'action hook, odd planned seconds': (w) => { eo(w, { hookPlan: hook('action') }); scene(w, 9)['Durată Scenă (secunde)'] = 40; scene(w, 1)['Durată Scenă (secunde)'] = 0.5; delete scene(w, 7)['Durată Scenă (secunde)']; },
  'slate hook, silent teaser shot': (w) => { eo(w, { hookPlan: hook('slate') }); delete scene(w, 9)['Voiceover URL']; },
  'hookPlan is a string': (w) => eo(w, { hookPlan: 'cliffhanger' }),
  // scene rows
  'missing Ordine on two scenes (createdTime sort)': (w) => { delete scene(w, 0)['Ordine Scenă']; scene(w, 3)['Ordine Scenă'] = '105'; },
  'no Ordine anywhere (id / time sort, first is the hook)': (w) => { for (const r of w.sceneRows) delete r.fields['Ordine Scenă']; w.sceneRows[4].createdTime = w.sceneRows[5].createdTime; },
  'duplicate row and a row with no id': (w) => { w.sceneRows.push(JSON.parse(JSON.stringify(w.sceneRows[2]))); w.sceneRows.push({ createdTime: '2026-09-01T00:00:00Z', fields: { 'Scene Final URL': 'https://x' } }); },
  'motif scene has no final clip (card and provenance fall away)': (w) => { const i = w.sceneRows.findIndex((r) => r.fields['Ordine Scenă'] === 3); w.sceneRows[i].fields['Scene Final URL'] = ''; },
  'scene with a non-http clip and a non-http voice': (w) => { scene(w, 4)['Scene Final URL'] = 'drive:abc'; scene(w, 5)['Voiceover URL'] = 'n/a'; },
  'last voiced scene is not the last scene': (w) => { const last = w.sceneRows.reduce((a, r) => (r.fields['Ordine Scenă'] > a.fields['Ordine Scenă'] ? r : a)); delete last.fields['Voiceover URL']; },
  'speaker tags in the narration': (w) => { scene(w, 5)['Script Scenă'] = '[NARRATOR] Rome [CHARACTER: Marcus Aurelius]   ate   bread.'; },
  'zero scenes': (w) => { w.sceneRows = []; },
  'no scene has a final clip': (w) => { for (const r of w.sceneRows) r.fields['Scene Final URL'] = null; },
  // overlays
  'caption colour #abc': (w) => eo(w, { captionColor: '#abc' }),
  'caption colour ff00AA': (w) => eo(w, { captionColor: ' ff00AA ' }),
  'caption colour white': (w) => eo(w, { captionColor: 'White' }),
  'caption colour garbage': (w) => eo(w, { captionColor: 'teal' }),
  'motif card by sceneIndex only': (w) => eo(w, { motifCards: [{ label: 'x', variant: 'figure', sceneIndex: 5, why: 'w', verdict: 'ok' }] }),
  'motif card sceneIndex out of range': (w) => eo(w, { motifCards: [{ label: 'x', sceneIndex: 99 }, { label: 'y', sceneOrder: 999 }] }),
  'motif cards but drawnCards false': (w) => eo(w, { drawnCards: false }),
  'motifCards not an array': (w) => eo(w, { motifCards: { a: 1 } }),
  'watermark scale 4 and open-once': (w) => eo(w, { category: 'documentary', watermarkScale: 4, watermarkOpenOnce: true }),
  'watermark scale 1.3': (w) => eo(w, { category: 'documentary', watermarkScale: '1.3' }),
  'montageIntensity 2': (w) => eo(w, { montageIntensity: 2 }),
  'montageIntensity "2" (refused)': (w) => eo(w, { montageIntensity: '2' }),
  'chapter cards and end screen off': (w) => eo(w, { chapterCards: false, endScreen: false }),
  'Editing Options malformed': (w) => { pf(w)['Editing Options'] = '{not json'; },
  'Editing Options null': (w) => { pf(w)['Editing Options'] = 'null'; },
  'Editing Options missing, untitled project, no tone': (w) => { delete pf(w)['Editing Options']; delete pf(w)['Nume Proiect']; delete pf(w).Tonalitate; },
  // Rome's scenes all carry the same provenance, so position and id cannot be
  // told apart on it; the rows also arrive out of film order. This makes
  // every scene's label distinct and drops one, which is the case the
  // id-matching exists for.
  'distinct provenance per scene, one scene dropped': (w) => {
    eo(w, { category: 'documentary' });
    w.sceneRows.forEach((r, i) => { r.fields.Provenance = { visualOrigin: i % 2 ? 'archival' : 'ai_generated', sourceName: 'src-' + r.fields['Ordine Scenă'] }; });
    w.sceneRows.find((r) => r.fields['Ordine Scenă'] === 102).fields['Scene Final URL'] = '';
    delete w.sceneRows.find((r) => r.fields['Ordine Scenă'] === 104).fields.Provenance;
  },
  // motion packs (Caption Colour since 362a9c56)
  'motion pack editorial': (w) => eo(w, { motionPack: 'editorial' }),
  'motion pack lowerThird on a documentary': (w) => eo(w, { category: 'documentary', motionPack: 'lowerThird' }),
  'motion pack unknown (dropped)': (w) => eo(w, { motionPack: 'Editorial' }),
  'category padded': (w) => eo(w, { category: '  kids  ' }),
  'category not a string': (w) => eo(w, { category: 7 }),
  'category whitespace only': (w) => eo(w, { category: '   ' }),
  // script / verify
  'script with no chapter markers': (w) => { w.script.fields['Script Content'] = 'Just prose.'; },
  'script row with no fields': (w) => { delete w.script.fields; },
  'verify missing (8 s fallback grid)': (w) => { delete w.assembled.verify; },
  'verify shorter than the clip list': (w) => { w.assembled.verify.sceneStartsSeconds = w.assembled.verify.sceneStartsSeconds.slice(0, 4); w.assembled.verify.voiceDurationsSeconds = [0, 2]; },
  'assemble outputUrl missing': (w) => { delete w.assembled.outputUrl; },
};

/** Cases where n8n and the engine are EXPECTED to differ, with the reason. None today. */
export const expectedDivergence = {};
