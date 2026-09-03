// The segmenter used to be TOLD a scene count and trusted to distribute the
// narration itself. gpt-5.4 quietly under-delivered: a 96-word chapter that
// asked for 5 scenes came back as ONE scene holding the first sentence, and
// the other 83 words vanished from the film (execution 877). Prompts cannot
// enforce this — so the split happens HERE, in code, and the model only
// writes visuals for text it is handed verbatim.
const WORDS_PER_SCENE = 22; // one 8-second beat
const wc = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

function planChunks(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  const total = wc(text);
  if (!total) return [];
  let target = Math.max(1, Math.ceil(total / WORDS_PER_SCENE));
  let units = (text.match(/[^.!?]+(?:[.!?]+["”’')]*|$)/g) || [text])
    .map((s) => s.trim())
    .filter(Boolean);
  if (!units.length) units = [text];
  let ideal = total / target;
  // Cut over-long units: first to REACH the target count, then to stop any
  // single unit dwarfing the rest. Clause punctuation preferred; a run-on
  // with no punctuation at all falls back to a word boundary.
  for (let guard = 0; guard < 80; guard++) {
    const need = units.length < target;
    let bi = -1, bw = 0, byClause = true;
    for (let k = 0; k < units.length; k++) {
      const w = wc(units[k]);
      if (w <= bw) continue;
      const has = /[,;:—]\s/.test(units[k]);
      if (!has && w < ideal * 1.8) continue;
      if (!need && w <= ideal * 1.5) continue;
      bw = w; bi = k; byClause = has;
    }
    if (bi < 0) break;
    const u = units[bi];
    const pos = [];
    const re = byClause ? /[,;:—]\s+/g : /\s+/g;
    let m;
    while ((m = re.exec(u)) !== null) pos.push(m.index + m[0].length);
    if (!pos.length) break;
    const mid = Math.floor(u.length / 2);
    let best = pos[0];
    for (const p of pos) if (Math.abs(p - mid) < Math.abs(best - mid)) best = p;
    const a = u.slice(0, best).trim(), b = u.slice(best).trim();
    if (!a || !b) break;
    units.splice(bi, 1, a, b);
  }
  target = Math.min(target, units.length);
  const chunks = [];
  let idx = 0, rem = total;
  for (let c = 0; c < target; c++) {
    const remC = target - c;
    const maxTake = units.length - idx - (remC - 1);
    const want = rem / remC;
    let take = 1, w = wc(units[idx]);
    while (take < maxTake) {
      const nxt = wc(units[idx + take]);
      if (w >= want * 0.75 || w + nxt > want * 1.45) break;
      w += nxt; take++;
    }
    chunks.push(units.slice(idx, idx + take).join(' '));
    idx += take; rem -= w;
  }
  if (idx < units.length) chunks[chunks.length - 1] += ' ' + units.slice(idx).join(' ');
  // An 8-second shot carrying four words is dead air — fold runts away.
  const floor = Math.max(6, (total / chunks.length) * 0.4);
  let k = 0;
  while (chunks.length > 1 && k < chunks.length) {
    if (wc(chunks[k]) < floor) {
      const j = (k > 0 && (k === chunks.length - 1 || wc(chunks[k - 1]) <= wc(chunks[k + 1]))) ? k - 1 : k + 1;
      const lo = Math.min(k, j), hi = Math.max(k, j);
      chunks.splice(lo, hi - lo + 1, chunks[lo] + ' ' + chunks[hi]);
      k = 0;
    } else k++;
  }
  return chunks;
}

const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const j = items[i].json;
  const chunks = planChunks(((j.fields || {})['Script Capitol']));
  const safe = chunks.length ? chunks : [String(((j.fields || {})['Script Capitol']) || '').trim()];
  console.log(`Chapter ${(j.fields || {})['Ordine']}: ${wc(((j.fields || {})['Script Capitol']))} words -> ${safe.length} scenes`);
  out.push({
    json: Object.assign({}, j, {
      sceneCount: safe.length,
      sceneChunks: safe,
      chunkList: safe.map((c, n) => `${n + 1}. ${c}`).join('\n'),
    }),
    // Save scenes To Airtable1 resolves the chapter record through
    // $('Create Chapter Records').item — keep the pairing intact.
    pairedItem: { item: i },
  });
}
return out;
