import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync('scenes.json','utf8'));

const STOP = new Set(('the a an and or but of to in on at for with from as is are was were be been being it its this that these those he she they his her their him them i you we us our your my me not no by into over under out up down off then than so if while when where which who whom what all any each other more most some such only own same too very can will just now over again once here there both few s t'.split(' ')));
const words = (s) => String(s||'').toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=4 && !STOP.has(w));

const byFilm = new Map();
for (const r of rows) {
  if (!byFilm.has(r.name)) byFilm.set(r.name, []);
  byFilm.get(r.name).push(r);
}
console.log('OVERLAP: share of narration content-words that also appear in that scene\'s own visual description\n');
console.log('film'.padEnd(44), 'tone'.padEnd(12), 'scenes', ' median', ' mean');
const all = [];
for (const [name, scs] of byFilm) {
  const shares = [];
  for (const s of scs) {
    const n = new Set(words(s.narration));
    const v = new Set(words(s.visual_prompt));
    if (n.size < 3) continue;
    let hit = 0; for (const w of n) if (v.has(w)) hit++;
    shares.push(hit / n.size);
  }
  if (!shares.length) continue;
  shares.sort((a,b)=>a-b);
  const med = shares[Math.floor(shares.length/2)];
  const mean = shares.reduce((a,b)=>a+b,0)/shares.length;
  all.push({name, med, mean, n: shares.length});
  console.log(String(name).replace(/\s+/g,' ').slice(0,42).padEnd(44), String(scs[0].tone).padEnd(12), String(shares.length).padStart(6), (med*100).toFixed(0).padStart(6)+'%', (mean*100).toFixed(0).padStart(5)+'%');
}
