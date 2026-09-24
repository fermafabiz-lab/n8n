// Turn a set of render props (the OUTPUT of Final Assembly, which is what
// db/port/motif-rescue/peking-props.json and remotion/motif/boyd-props.json
// are) back into the INPUTS the n8n bodies read: hov.at_scene rows, a project
// row, a script row and the assemble server's verify. These are synthetic —
// the props files are not an expected output here. What they buy is two
// films unlike Rome: 48 scenes across several chapters, and a short
// documentary with a hook, so every body runs on more than one shape.
import fs from 'node:fs';

export function worldFromProps(file, { id, category, extra = {} }) {
  const props = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = Date.parse('2026-09-01T10:00:00.000Z');
  const inChapter = {};
  const sceneRows = props.scenes.map((s, i) => {
    const ch = s.chapter || 0;
    inChapter[ch] = (inChapter[ch] || 0) + 1;
    const text = s.narratorText || '';
    return {
      id: `rec${id}${String(i).padStart(3, '0')}`,
      createdTime: new Date(base + i * 1000).toISOString(),
      fields: {
        Project_ID: `rec${id}Project`,
        'Aprobare Scenă': true,
        'Ordine Scenă': ch * 100 + inChapter[ch],
        'Scene Final URL': `https://example.org/${id}/clip-${i}.mp4`,
        ...(text ? { 'Voiceover URL': `https://example.org/${id}/voice-${i}.mp3` } : {}),
        'Script Scenă': text,
        'Durată Scenă (secunde)': ch === 0 ? 3 : 8,
        ...(i % 3 === 0 ? { Provenance: { visualOrigin: i % 2 ? 'archival' : 'ai_generated' } } : {}),
      },
    };
  });
  const chapters = [...new Set(props.scenes.map((s) => s.chapter || 0))].filter((c) => c > 0);
  const last = props.scenes[props.scenes.length - 1];
  return {
    name: id,
    webhookBody: { Project_ID: `rec${id}Project` },
    sceneRows,
    project: {
      id: `rec${id}Project`,
      createdTime: new Date(base).toISOString(),
      fields: {
        'Nume Proiect': props.projectTitle,
        Tonalitate: props.tone,
        Format: '16:9',
        Pace: 'Normal',
        'Editing Options': JSON.stringify({ category, chapterCards: props.showChapterCards !== false, music: true, ...extra }),
      },
    },
    script: {
      id: `rec${id}Script`,
      createdTime: new Date(base).toISOString(),
      fields: { 'Script Content': chapters.map((c) => `[CHAPTER ${c}: Chapter ${c} of ${props.projectTitle}]\nText.`).join('\n\n') },
    },
    rootFiles: [
      { id: 'fld-doc', name: 'Documentary', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'fld-default', name: 'Default', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'loose-1', name: 'default-1.mp3', mimeType: 'audio/mpeg' },
    ],
    driveFolders: {
      'fld-doc': [{ id: 'doc-a', name: 'a.mp3', mimeType: 'audio/mpeg' }, { id: 'doc-b', name: 'b.mp3', mimeType: 'audio/mpeg' }],
      'fld-default': [{ id: 'def-a', name: 'x.mp3', mimeType: 'audio/mpeg' }],
    },
    random: 0.7,
    assembled: {
      status: 'done',
      progress: 1,
      outputUrl: `http://render.example/output/${id}.mp4`,
      verify: {
        videoSeconds: last.startSeconds + last.durationSeconds,
        sceneStartsSeconds: props.scenes.map((s) => s.startSeconds),
        voiceDurationsSeconds: props.scenes.map((s) => s.speechSeconds ?? (s.narratorText ? +(s.durationSeconds * 0.8).toFixed(3) : 0)),
      },
    },
    assemblePolls: 3,
  };
}
