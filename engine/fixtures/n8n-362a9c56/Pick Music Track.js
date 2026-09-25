// Track selection order:
//   0. a track PINNED by the producer (Editing Options.musicTrack) wins outright
//   1. files inside the tone-matched subfolder (Muzica/Dark, Muzica/Default...)
//   2. loose files in Muzica whose NAME contains the tone (dark-1.mp3)
//   3. loose files named default*
//   4. any loose file
// Multiple candidates -> random pick, so repeat videos vary.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const isFile = (f) => f && f.id && !(f.mimeType || '').includes('folder');
// 0: the producer chose a specific track on the site (MusicPicker). The id is
// a Drive file id already shared anyone-with-link by the share-music webhook,
// so the same Railway proxy URL works for it as for every auto-picked track.
try {
  const opts = JSON.parse($('Fetch Project Info').first().json.fields['Editing Options'] || '{}') || {};
  const pinned = opts.musicTrack;
  if (pinned && typeof pinned.id === 'string' && pinned.id.trim()) {
    const id = pinned.id.trim();
    return [{ json: { id, name: String(pinned.name || id), matched: 'pinned', url: 'https://n8n-production-55dd.up.railway.app/media?id=' + id } }];
  }
} catch (e) {}
let tone = 'default';
try { tone = norm($('Fetch Project Info').first().json.fields.Tonalitate); } catch (e) {}
let subFiles = [];
try { subFiles = ($input.first().json.files || []).filter(isFile); } catch (e) {}
let rootFiles = [];
try { rootFiles = ($('List Music').first().json.files || []).filter(isFile); } catch (e) {}
const byTone = rootFiles.filter(f => norm(f.name).includes(tone));
const byDefault = rootFiles.filter(f => norm(f.name).includes('default'));
const pool = subFiles.length ? subFiles : (byTone.length ? byTone : (byDefault.length ? byDefault : rootFiles));
if (!pool.length) return [{ json: { url: null, name: null, reason: 'no tracks in Muzica folder' } }];
const t = pool[Math.floor(Math.random() * pool.length)];
// Served through our Railway media proxy so ffmpeg gets a real audio
// stream (Drive's direct links answer with redirects/HTML).
return [{ json: { id: t.id, name: t.name, matched: subFiles.length ? 'subfolder' : (byTone.length ? 'tone-name' : (byDefault.length ? 'default' : 'any')), url: 'https://n8n-production-55dd.up.railway.app/media?id=' + t.id } }];