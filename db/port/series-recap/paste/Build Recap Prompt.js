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
// The budget. `Parse Recap` holds a ceiling 25% above it and must move with it.
const RECAP_WORDS = 80;
const payload = {
  model: 'gpt-5.4',
  messages: [
    {
      role: 'system',
      content:
        'You keep the running recap of an episodic series of short films. From the narration of ONE episode, write what happened in it: the events, who did what, and how it ended. ' +
        // THE WORDING BELOW IS MEASURED. Do not soften it.
        //
        // This asked for "two sentences, at most 60 words" until 2026-09-19 and
        // got about a hundred, every time; raised to 100 it wrote 128. The
        // obvious reading — a model overshoots any cap by a third — was wrong.
        // Four phrasings were run against the same two narrations, a 1.4 KB kids
        // episode and the 11.4 KB Burj Al Arab documentary, three runs each at a
        // budget of 80 words (probe execution 15110/15111):
        //
        //   "at most 80 words"                        92, 97
        //   "budget of 80 words you cannot spend"     78, 77, 73, 81, 77, 77
        //   THIS ONE (hard rule + count your draft)   73, 75, 80, 71, 76, 72
        //
        // Eight of eight inside the budget, on both a short film and the longest
        // script in the database — where the soft wording was 15-21% over and
        // the budget wording went over once. So a cap is obeyed or ignored
        // according to how it is PHRASED, not according to the number. What does
        // the work here is naming length as a rule, asking for the count before
        // the answer, and saying what happens to an answer that is too long.
        //
        // Changing RECAP_WORDS is free. Changing these sentences means running
        // the probe again — and moving `Parse Recap`'s ceiling with it.
        'LENGTH IS A HARD RULE: your whole answer must be ' + RECAP_WORDS + ' words or fewer. ' +
        'One or two sentences, in ' + language + ', in the past tense. ' +
        'Count the words of your draft before you answer; if it is over ' + RECAP_WORDS + ', cut the least important detail and rewrite until it fits. ' +
        'An answer longer than ' + RECAP_WORDS + ' words is rejected and useless. ' +
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
return [{ json: { project_id: String(r.id), series_id: String(r.series_id), episode_no: episodeNo, title: title || 'Untitled', words_asked: RECAP_WORDS, payload } }];
