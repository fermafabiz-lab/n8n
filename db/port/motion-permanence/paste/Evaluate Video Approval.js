const expected = $('Sort & Cap Scenes').all().map(s => s.json.id);
const order = {};
expected.forEach((id, i) => order[id] = i);
const seen = new Set();
const recs = $input.all()
  .filter(r => order[r.json.id] !== undefined)
  .filter(r => { if (seen.has(r.json.id)) return false; seen.add(r.json.id); return true; })
  .slice()
  .sort((a, b) => order[a.json.id] - order[b.json.id]);
// One regen per polling cycle: keeps the submit->poll->mux chain simple and
// avoids splitInBatches re-entry problems. Remaining flags are picked up on
// the next 15s cycle automatically.
let regen = null;
for (const r of recs) {
  const f = r.json.fields || {};
  if (f['Regenerează Video'] === true) {
    // `Observații Scenă` IS NOT A PRODUCER-ONLY FIELD, and that is what makes
    // the reordering below dangerous without this line. Five nodes in this
    // workflow write MACHINE text into it and none of them ever clears it:
    // `VP Apply` ("AUTO-REWRITE-VIDEO (attempt N): the video filter refused
    // this scene — …"), `Apply Rewritten Prompt`, `Mark Flow Upload Rejected`,
    // `Mark Video Prompt Rejected` and `Mark Regen Filtered` (all "REJECTED by
    // …"). `VP Apply` writes that note AND sets `Regenerează Video: true` in
    // the same statement, so the very next poll arrives here with a machine
    // sentence sitting in the producer's feedback slot.
    //
    // Before the reordering this was hidden by a bug: the note was appended
    // after the legacy "Negative:" tail and `Submit Video Regen` cut it off.
    // Strip-then-append fixes the producer's case and would have handed Veo
    // "the new video MUST follow this: AUTO-REWRITE-VIDEO (attempt 2): the
    // video filter refused this scene …" as a mandatory instruction. Worse, it
    // would persist: nothing clears the field, so every later regeneration of
    // that scene would carry it again.
    //
    // `Evaluate Image Approval` one gate upstream already solves this with the
    // same test, and this is deliberately the same shape so the two stay
    // greppable together. Extend BOTH if a sixth machine writer appears.
    let feedback = String(f['Observații Scenă'] || '').trim();
    if (/^(AUTO-REWRITE|REJECTED)/i.test(feedback)) feedback = '';
    // 2026-09-13 — WHERE THE PRODUCER'S CORRECTION LANDS IN THE PROMPT.
    //
    // `Video Scenă URL` holds the motion PROMPT, not a URL (historic field
    // name, same everywhere in this workflow).
    //
    // This node used to build the regeneration brief in this order:
    //
    //     <stored prompt, legacy "Negative: …" tail and all>
    //       + ' ADJUSTMENT REQUEST — the new video MUST follow this: …'
    //
    // which put the one piece of text a human actually typed AFTER the token
    // "Negative:", i.e. inside a list of prohibitions. A producer typing "she
    // should keep holding the stack" was handing the model one more thing to
    // avoid.
    //
    // And it was worse than badly placed: it was DELETED. `Submit Video
    // Regen` strips the legacy tail with split(/\s*Negative:\s*/i)[0] before
    // composing today's guardrails, so on any scene whose stored prompt still
    // carries that tail — 368 of the 504 rows written in the three weeks up to
    // today — the split cut the prompt at "Negative:" and took everything
    // BEFORE it, throwing the ADJUSTMENT REQUEST away with the tail. The
    // producer rejected a clip, wrote what was wrong with it, waited a minute
    // and a half, and got a re-roll of the identical brief. That is the shape
    // of "regenerate does nothing".
    //
    // So: strip FIRST, then append the correction. The stored prompt is
    // reduced to the ACTION ONLY with the same canonical split used by
    // `Current Scene`, `End Frame Prompt` and (as an instruction) `VP Rewrite
    // AI`, and the producer's words become part of that action. The
    // guardrails — shot rules in front, world rules and the trailing noun
    // list behind — are composed at submit time by `Submit Video Regen` and
    // must not be here.
    //
    // Two downstream readers get this for free, and both already claimed it
    // in their own comments:
    //   - `RG End Frame Prompt` draws the after-frame from `motionPrompt` and
    //     does NOT strip anything itself, so it was handing nano-banana-2
    //     "no subtitles, no lip movement" as drawing instructions.
    //   - `RG Motion Prep` judges the finished clip against `motionPrompt`.
    //     The brief it scores is now the action plus the human's correction,
    //     which is what its comment says it is.
    //
    // The 'ADJUSTMENT REQUEST — the new video MUST follow this: ' wording is
    // quoted verbatim in both of those nodes' comments. If it ever changes,
    // change it in all three.
    //
    // The tail-only edge must NEVER produce an empty prompt. `Prep Video
    // Regen` throws "has no motion prompt" on one, and it carries no onError
    // setting, so that throw aborts the WHOLE Media Generation execution —
    // the batch loop, the image gate and the video gate for every other scene
    // — and strands `Regenerează Video` true with no writer left inside the
    // run to clear it. A row whose stored prompt is nothing but a tail is
    // rare, but "rare" and "takes the film down with it" is not a trade worth
    // making for tidiness. Falling back to the raw stored string restores
    // exactly the pre-2026-09-13 behaviour for that one case and can only be
    // better than nothing.
    const storedPrompt = String(f['Video Scenă URL'] || '');
    const action = storedPrompt.split(/\s*Negative:\s*/i)[0].trim();
    let motionPrompt = action || storedPrompt.trim();
    if (feedback) {
      // Defensive, and only against the literal section token: if a producer
      // types "Negative:" in their note, the submit-time split would truncate
      // the prompt at their own words. Softening the colon keeps every word
      // they wrote and leaves nothing downstream can read as a header.
      const note = feedback.replace(/\bNegative\s*:/gi, 'Negative,');
      motionPrompt += ' ADJUSTMENT REQUEST — the new video MUST follow this: ' + note + '.';
    }
    regen = { id: r.json.id, motionPrompt, imageId: f['Image Media ID'] || '', voiceUrl: f['Voiceover URL'] || '' };
    break;
  }
}
// Voice-only regeneration (site button): new TTS from the (possibly edited)
// narration, re-muxed onto the EXISTING clip — no image/video redo.
let voiceRegen = null;
for (const r of recs) {
  const f = r.json.fields || {};
  if (f['Regenerează Voce'] === true) {
    voiceRegen = {
      id: r.json.id,
      text: String(f['Script Scenă'] || '').trim(),
      clipUrl: String(f['Scene Final URL'] || ''),
    };
    break;
  }
}
const total = recs.length;
// A scene only counts as approved if its muxed clip actually exists —
// bulk-approving before generation finished must not open the gate.
const approved = recs.filter(r => { const f = r.json.fields || {}; return f['Aprobare Video'] === true && String(f['Scene Final URL'] || '').startsWith('http'); }).length;
return [{ json: { anyRegen: !!regen, anyVoiceRegen: !!voiceRegen, allApproved: total > 0 && approved === total, regen, voiceRegen, total, approved } }];
