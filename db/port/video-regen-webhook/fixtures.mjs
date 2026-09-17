// Real rows, read out of Postgres on 2026-09-17 (project recqbPJ7aZu0a21mt,
// "The Roman slave who conquered Egypt" — the film the producer was waiting
// on when this whole thread started). Trimmed only where a field's bulk adds
// nothing: the project's Editing Options keeps the keys these nodes actually
// read plus enough neighbours to stay a realistic parse target.
//
// `Video Scenă URL` is kept VERBATIM, legacy "Negative: …" tail and all,
// because the tail is exactly what the composition has to strip.

export const SCENE_ID = 'recJtw0a2oGzyKaIz';
export const PROJECT_ID = 'recqbPJ7aZu0a21mt';

export const MOTION_STORED =
  'Crash-zoom toward the foremost amphora as it settles with a small forward rock and remains in place, the packed villa service court and stacked grain staying still behind it in cold dawn contrast. History, Epic mood, cinematic. Negative: on-screen text, subtitles, captions, watermark, logos, speech, lip movement, dialogue, music, extra people, duplicated subject, morphing, warping, reversed playback.';
export const MOTION_ACTION =
  'Crash-zoom toward the foremost amphora as it settles with a small forward rock and remains in place, the packed villa service court and stacked grain staying still behind it in cold dawn contrast. History, Epic mood, cinematic.';
export const IMAGE_ID =
  'user:2923-email:6665726d61666162697a40676d61696c2e636f6d-image:e02768d9-6c3a-471b-940e-5d46231b6fbb';
export const VOICE_URL =
  'https://drive.google.com/uc?export=download&id=15LQzBvVzMa0Cxkr4sP2OOsRlla4IXhUh';

/** One take already filed for this shot — `Prep Video Regen` counts these. */
export const VERSIONS = JSON.stringify([{
  at: '2026-09-17T13:47:23.991Z', id: 'vmu5l3g7r', kind: 'video', last: true, auto: true,
  url: 'https://house-of-videos.com/media/recJtw0a2oGzyKaIz/video/881ccc51a1ce853cc249ce842703846a.mp4',
  prompt: MOTION_STORED,
}]);

export const EDITING_OPTIONS = JSON.stringify({
  sfx: true, music: true, speed: 1, category: 'story', sfxLevel: 0.35,
  createdBy: 'Dan', endScreen: true, hookStyle: 'auto', musicLevel: 0.22,
  autoApprove: false, multiVoiceMode: 'off', sourceWatermark: false,
  castSheets: { Lazarus: { id: 'user:2923-…-image:926d238b', url: '', kind: 'turnaround' } },
});

/** The scene as `hov.at_scene` hands it over, with the flag the site sets. */
export function sceneFields(over = {}) {
  return Object.assign({
    'Project_ID': PROJECT_ID,
    'Ordine Scenă': 2,
    'Script Scenă': '1,000 amphorae of stolen grain.',
    'Video Scenă URL': MOTION_STORED,
    'Image Media ID': IMAGE_ID,
    'Voiceover URL': VOICE_URL,
    'Scene Final URL': 'https://drive.google.com/uc?export=download&id=17UdqP-qG5BTER4Zh9Z-uGiqEFEu3OnVN',
    'Versiuni Media': VERSIONS,
    'Observații Scenă': '',
    'Aprobare Imagine': true,
    'Aprobare Voce': true,
    'Aprobare Video': false,
    'Regenerează Video': true,
    'Regenerează Voce': false,
    'Regenerează Imagine': false,
    'Status Producție Scenă': 'Așteaptă Aprobare Video',
  }, over);
}

export function projectFields(over = {}) {
  return Object.assign({ 'Format': '16:9', 'Editing Options': EDITING_OPTIONS }, over);
}
