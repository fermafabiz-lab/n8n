// What should happen next, asked of the show itself.
//
// The producer's complaint this answers: opening the brief from a series gave
// them a blank title field and no idea where to start. So the prompt is not
// "invent a video" — it is "you know this cast, these places and what has
// already happened; what is episode N". The recap is the whole point of the
// call and is sent in full (it is one line per episode, capped by the site).
//
// Two things it must NOT do: repeat a title the show has used, and resolve
// the series. A show is only a show while it can keep going.
// Never return zero items. Everything downstream is one chain ending in the
// Respond node, and a webhook that never responds is a button that spins for
// seventy-five seconds and then says the network failed. An unknown id
// travels as `skip` instead, exactly like Expand Brief does: the model call
// fails on the null body, continues on error, and Parse Episode answers the
// empty shape.
const r = $json || {};
if (!r.id) {
  console.log('EPISODE SKIP: no such series');
  return [{ json: { skip: true, payload: null, series_id: '', episode_no: 0 } }];
}
// The language the FORM is on right now beats the show's stored one: the
// picker opens on the series' language, so the two agree until the producer
// changes it — and when they do, they are telling this button what they want
// the suggestion written in. Reading only `r.language` answered a Romanian
// brief in English.
let posted = '';
try { posted = String(($('Episode Webhook').first().json.body || {}).language || '').trim(); } catch (e) { posted = ''; }
const language = (posted || String(r.language || 'English')).trim().slice(0, 40) || 'English';
const episodeNo = Number(r.next_episode) || 1;
const used = String(r.episode_titles || '').split('\n').map(s => s.trim()).filter(Boolean);
const payload = {
  model: 'gpt-5.4',
  messages: [
    {
      role: 'system',
      content:
        'You are the story editor of an episodic series of short films. Given the show and what has already happened, propose the NEXT episode. ' +
        'Answer with JSON only, exactly {"title": "...", "idea": "..."}. ' +
        'The title is at most 8 words, in ' + language + ', with no episode number and no quotes. ' +
        'The idea is 2-4 sentences in ' + language + ': what happens in this episode, which of the existing characters it is about, and where. ' +
        'Write the idea as plain prose a person would read out. The places below are listed as production labels — name them the way the story would ' +
        '("the meadow", "Pip\'s cottage"), never by pasting a label with its dash and qualifier into a sentence. ' +
        'Rules: use the existing characters by their exact names; keep the episode inside the places the show already has, and invent at most one new character or place, and only if the episode needs it; ' +
        'do not contradict what has already happened and do not retell it; do not end the series or resolve its premise for good; ' +
        'each episode is a self-contained story with its own beginning and end.'
    },
    {
      role: 'user',
      content:
        'Series: ' + String(r.name || '').trim().slice(0, 160) +
        (String(r.premise || '').trim() ? '\nWhat the show is: ' + String(r.premise).trim().slice(0, 1200) : '') +
        (String(r.tone || '').trim() ? '\nTone: ' + String(r.tone).trim().slice(0, 60) : '') +
        (String(r.characters || '').trim() ? '\nCharacters: ' + String(r.characters).trim().slice(0, 1200) : '') +
        (String(r.places || '').trim() ? '\nPlaces: ' + String(r.places).trim().slice(0, 1200) : '') +
        (String(r.previously || '').trim()
          ? '\n\nWHAT HAS HAPPENED SO FAR:\n' + String(r.previously).trim().slice(0, 6000)
          : '\n\nThis is the first episode after the one the show was started from.') +
        (used.length ? '\n\nTITLES ALREADY USED (never repeat one):\n' + used.slice(-20).join('\n') : '') +
        '\n\nPropose episode ' + episodeNo + '.'
    }
  ],
  response_format: { type: 'json_object' }
};
return [{ json: { skip: false, series_id: String(r.id), episode_no: episodeNo, payload } }];
