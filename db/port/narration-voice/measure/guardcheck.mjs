import fs from 'node:fs';
const src = fs.readFileSync('/home/user/n8n/db/port/narration-voice/code/cs-Narration_Guard.txt','utf8');
const pick = (n) => { const m = src.match(new RegExp('const '+n+' = (/.*?/i);')); return eval(m[1]); };
const TEXTURE = pick('TEXTURE'), CAMERA = pick('CAMERA'), SCENERY = pick('SCENERY');
const TEXTURE_PER100 = 0.4, TEXTURE_MIN = 4, CAMERA_MIN = 2, SCENERY_PCT = 12, SCENERY_MIN = 4;
const rows = JSON.parse(fs.readFileSync('scenes.json','utf8'));
const sentences = (s) => String(s||'').replace(/\s+/g,' ').split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
const byFilm = new Map();
for (const r of rows) { if (!byFilm.has(r.name)) byFilm.set(r.name, []); byFilm.get(r.name).push(r); }
for (const [name, scs] of byFilm) {
  const text = scs.filter(s=>s.scene_order>=100).map(s=>s.narration).join(' ');
  const ss = sentences(text); const ws = text.split(/\s+/).filter(Boolean);
  let t=0,k=0; for (const x of ws){ if(TEXTURE.test(x)) t++; if(CAMERA.test(x)) k++; }
  const sc = ss.filter(s=>SCENERY.test(s));
  const tex100 = 100*t/ws.length, scpct = Math.round(100*sc.length/ss.length);
  const describing = (tex100 >= TEXTURE_PER100 && t >= TEXTURE_MIN) || k >= CAMERA_MIN || (scpct >= SCENERY_PCT && sc.length >= SCENERY_MIN);
  console.log((describing?'FIRE ':'ok   ')+String(name).slice(0,40).padEnd(42), scs[0].tone.padEnd(12), 'tex', t, tex100.toFixed(2), 'cam', k, 'scenery', sc.length+'/'+ss.length, scpct+'%');
}
