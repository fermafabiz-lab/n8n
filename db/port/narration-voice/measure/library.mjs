import fs from 'node:fs';
const clean = (raw) => String(raw||'').replace(/\r\n?/g,'\n')
  .replace(/(?:^|\n|\s)\d{1,5}\s*\n?\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g,' ')
  .replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g,' ')
  .replace(/\[(?:music|applause|laughter|laughs|sighs|inaudible)\]/gi,' ').replace(/(?:^|\s)>>\s?/g,' ')
  .replace(/\\h/g,' ').replace(/\s+/g,' ').trim();
const TEXTURE = /\b(glossy|gleam\w*|glint\w*|glow\w*|shimmer\w*|slick|matte|hazy|haze|mist\w*|spray|steam|sparks?|strob\w*|puls\w*|flash\w*|reflections?|sheen|striped|printed|tinted|chrome|glare)\b/i;
const CAMERA = /\b(shot|frame|framed|camera|angle|close-?up|pan|tilt|zoom|lens|foreground|background|silhouette|vantage)\b/i;
const rows = JSON.parse(fs.readFileSync('lib.json','utf8'));
console.log('REFERENCE LIBRARY — real scripts from the channels you collected\n');
console.log('title'.padEnd(46),'tone'.padEnd(12),'words','texture/100w','cam/100w');
let tt=0, tc=0, tw=0;
for (const r of rows) {
  const t = clean(r.chunk); const w = t.split(/\s+/).filter(Boolean);
  let tex=0, cam=0; for (const x of w){ if(TEXTURE.test(x)) tex++; if(CAMERA.test(x)) cam++; }
  tt+=tex; tc+=cam; tw+=w.length;
  console.log(String(r.title).replace(/\s+/g,' ').slice(0,44).padEnd(46), String(r.tone).padEnd(12), String(w.length).padStart(5), (100*tex/w.length).toFixed(1).padStart(11), (100*cam/w.length).toFixed(1).padStart(8));
}
console.log('\nLIBRARY TOTAL'.padEnd(46), ''.padEnd(12), String(tw).padStart(5), (100*tt/tw).toFixed(1).padStart(11), (100*tc/tw).toFixed(1).padStart(8));
