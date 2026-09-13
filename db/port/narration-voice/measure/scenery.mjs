import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync('scenes.json','utf8'));
const sentences = (s) => String(s||'').replace(/\s+/g,' ').split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
const SCENERY = /^(?:the\s+)?(?:rain|snow|fog|mist|wind|light|sunlight|daylight|dusk|dawn|night|morning|shadows?|road|sky|sea|water|river|walls?|floor|air|sun|street|streets|city|harbou?r|roof|room|door|window|glass|steel|stone|concrete|smoke|dust|steam|sparks|sirens?|lamps?|lights|warehouses?|container|towers?|cranes?|barges?|traffic)\b/i;
const TEXTURE = /\b(glossy|gleam\w*|glint\w*|glow\w*|shimmer\w*|slick|matte|hazy|haze|mist\w*|spray|steam|sparks?|strob\w*|puls\w*|flash\w*|reflections?|sheen|striped|printed|tinted|chrome|glare)\b/i;
const CAMERA = /\b(shot|frame|framed|camera|angle|close-?up|lens|foreground|background|silhouette|vantage)\b/i;
const byFilm = new Map();
for (const r of rows) { if (!byFilm.has(r.name)) byFilm.set(r.name, []); byFilm.get(r.name).push(r); }
console.log('film'.padEnd(40),'sent','scenery-openers','tex/100','tex-hits','cam');
for (const [name, scs] of byFilm) {
  const text = scs.filter(s=>s.scene_order>=100).map(s=>s.narration).join(' ');
  const ss = sentences(text); const w = text.split(/\s+/).filter(Boolean);
  const sc = ss.filter(s=>SCENERY.test(s)).length;
  let tex=0, cam=0; for (const x of w){ if(TEXTURE.test(x)) tex++; if(CAMERA.test(x)) cam++; }
  console.log(String(name).replace(/\s+/g,' ').slice(0,38).padEnd(40), String(ss.length).padStart(4), (sc+' ('+(100*sc/ss.length).toFixed(0)+'%)').padStart(15), (100*tex/w.length).toFixed(2).padStart(8), String(tex).padStart(8), String(cam).padStart(4));
}
