// Subfolder-per-tone layout: Muzica/Dark, Muzica/Epic, ... If a subfolder
// matches the project's Tonalitate (or 'Default' as fallback), its files
// are preferred over loose files in the root.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
let tone = 'default';
try { tone = norm($('Fetch Project Info').first().json.fields.Tonalitate); } catch (e) {}
let folders = [];
try { folders = ($input.first().json.files || []).filter(f => (f.mimeType || '').includes('folder')); } catch (e) {}
const hit = folders.find(f => norm(f.name).includes(tone)) || folders.find(f => norm(f.name).includes('default')) || null;
return [{ json: { folderId: hit ? hit.id : null, folderName: hit ? hit.name : null } }];