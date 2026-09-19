// What happened in this episode, asked of the model from the approved
// narration. Nothing else is in the prompt: not the bible, not the earlier
// recap — the line has to stand on its own, because it is read later by a
// writer who has the bible separately and must not be told the same thing
// twice. The script is capped well above the longest film (an 8-minute one
// is ~7,000 characters) so a runaway paste cannot cost a fortune.
const r = $json;
const script = String(r.script || '').trim();
const episodeNo = Number(r.episode_no) || 0;
if (!script || script.length < 80 || !episodeNo || !r.series_id) {
  console.log('RECAP SKIP ' + String(r.id || '?') + ': ' + (!r.series_id ? 'not an episode' : !episodeNo ? 'no episode number' : 'no approved script'));
  return [];
}
const language = String(r.language || 'English').trim().slice(0, 40) || 'English';
const title = String(r.name || '').trim().slice(0, 160);
const payload = {
  model: 'gpt-5.4',
  messages: [
    {
      role: 'system',
      content:
        'You keep the running recap of an episodic series of short films. From the narration of ONE episode, write what happened in it: the events, who did what, and how it ended. ' +
        // 100, not the 60 this asked for until 2026-09-19. The model had been
        // ignoring 60 and writing about 100 anyway, so the instruction was
        // describing something that was not happening — and the longer line is
        // the better one for the job: the next episode's writer reads this to
        // avoid contradicting and avoid retelling, and neither is possible if
        // the events are not named. The cost is measured on the same episode
        // both ways, not guessed: a line runs 717 characters against the 591
        // it ran at 60 words, so composeSeriesLore's 8,000-character Lore cap
        // starts trimming the OLDEST lines at about episode 11 instead of
        // about 13. Trimming is oldest-first and keeps the newest, so it
        // degrades gently; revisit before a show gets there. Note what the two
        // measurements say about the cap itself: 60 asked produced ~100 words,
        // 100 asked produced 128 — the model overshoots by about a third
        // whatever it is told, so this number MOVES the length, it does not
        // hold it.
        'Two sentences, at most 100 words, in ' + language + ', in the past tense. ' +
        'Use the characters\' names exactly as the narration spells them. State only what the narration says: no interpretation, no moral, no praise, no preamble, no quotes, no headings, no line breaks.'
    },
    {
      role: 'user',
      content:
        'Series: ' + String(r.series_name || '').trim().slice(0, 160) +
        (String(r.premise || '').trim() ? '\nPremise: ' + String(r.premise).trim().slice(0, 1200) : '') +
        '\nEpisode ' + episodeNo + ': ' + (title || 'Untitled') +
        '\n\nNARRATION:\n' + script.slice(0, 30000)
    }
  ]
};
return [{ json: { project_id: String(r.id), series_id: String(r.series_id), episode_no: episodeNo, title: title || 'Untitled', payload } }];
