import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

// Series Next — "✨ Suggest episode N" on the brief.
// POST {series_id, language} from app/api/series-next/route.ts; answers
// {title, idea}. Responds through a Respond node because the site waits on
// it (unlike series-recap, which is fire-and-forget).

const nextWebhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Episode Webhook', position: [240, 300], parameters: { httpMethod: 'POST', path: 'series-next', responseMode: 'responseNode' } },
});

const loadSeries = node({
  type: 'n8n-nodes-base.postgres', version: 2.7,
  config: {
    name: 'Load Series', position: [460, 300], alwaysOutputData: true,
    parameters: { operation: 'executeQuery', query: "-- Everything the model needs to invent the next episode of a show, by id.\n-- The site posts nothing but that id (app/api/series-next/route.ts), so what\n-- reaches the prompt is what the database holds, never what a browser typed.\n--\n-- The bible is stored in the Story Bible's own spelling — `name` and\n-- `visual_description` per character — so the names come out of the jsonb\n-- rather than out of a column. `episode_titles` is every title the show has\n-- used, oldest first, which is the list the prompt must not repeat.\nselect s.id,\n       s.name,\n       coalesce(nullif(s.premise, ''), s.bible->>'logline', '') as premise,\n       coalesce(s.previously, '') as previously,\n       coalesce(nullif(s.language, ''), 'English') as language,\n       coalesce(s.category, 'story') as category,\n       coalesce(s.tone, '') as tone,\n       coalesce((select string_agg(c->>'name', ' | ')\n                   from jsonb_array_elements(coalesce(s.bible->'characters', '[]'::jsonb)) c), '') as characters,\n       coalesce((select string_agg(l->>'name', ' | ')\n                   from jsonb_array_elements(coalesce(s.bible->'locations', '[]'::jsonb)) l), '') as places,\n       coalesce((select string_agg(p.name, E'\\n' order by p.episode_no nulls last, p.created_at)\n                   from hov.project p where p.series_id = s.id), '') as episode_titles,\n       coalesce((select max(p.episode_no) from hov.project p where p.series_id = s.id), 0) + 1 as next_episode\n  from hov.series s\n where s.id = $1", options: { queryReplacement: expr('{{ [String($json.body.series_id || "")] }}') } },
    credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } },
  },
});

const buildEpisodePrompt = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Episode Prompt', position: [680, 300], parameters: { mode: 'runOnceForAllItems', jsCode: "// What should happen next, asked of the show itself.\n//\n// The producer's complaint this answers: opening the brief from a series gave\n// them a blank title field and no idea where to start. So the prompt is not\n// \"invent a video\" — it is \"you know this cast, these places and what has\n// already happened; what is episode N\". The recap is the whole point of the\n// call and is sent in full (it is one line per episode, capped by the site).\n//\n// Two things it must NOT do: repeat a title the show has used, and resolve\n// the series. A show is only a show while it can keep going.\n// Never return zero items. Everything downstream is one chain ending in the\n// Respond node, and a webhook that never responds is a button that spins for\n// seventy-five seconds and then says the network failed. An unknown id\n// travels as `skip` instead, exactly like Expand Brief does: the model call\n// fails on the null body, continues on error, and Parse Episode answers the\n// empty shape.\nconst r = $json || {};\nif (!r.id) {\n  console.log('EPISODE SKIP: no such series');\n  return [{ json: { skip: true, payload: null, series_id: '', episode_no: 0 } }];\n}\n// The language the FORM is on right now beats the show's stored one: the\n// picker opens on the series' language, so the two agree until the producer\n// changes it — and when they do, they are telling this button what they want\n// the suggestion written in. Reading only `r.language` answered a Romanian\n// brief in English.\nlet posted = '';\ntry { posted = String(($('Episode Webhook').first().json.body || {}).language || '').trim(); } catch (e) { posted = ''; }\nconst language = (posted || String(r.language || 'English')).trim().slice(0, 40) || 'English';\nconst episodeNo = Number(r.next_episode) || 1;\nconst used = String(r.episode_titles || '').split('\\n').map(s => s.trim()).filter(Boolean);\nconst payload = {\n  model: 'gpt-5.4',\n  messages: [\n    {\n      role: 'system',\n      content:\n        'You are the story editor of an episodic series of short films. Given the show and what has already happened, propose the NEXT episode. ' +\n        'Answer with JSON only, exactly {\"title\": \"...\", \"idea\": \"...\"}. ' +\n        'The title is at most 8 words, in ' + language + ', with no episode number and no quotes. ' +\n        'The idea is 2-4 sentences in ' + language + ': what happens in this episode, which of the existing characters it is about, and where. ' +\n        'Write the idea as plain prose a person would read out. The places below are listed as production labels — name them the way the story would ' +\n        '(\"the meadow\", \"Pip\\'s cottage\"), never by pasting a label with its dash and qualifier into a sentence. ' +\n        'Rules: use the existing characters by their exact names; keep the episode inside the places the show already has, and invent at most one new character or place, and only if the episode needs it; ' +\n        'do not contradict what has already happened and do not retell it; do not end the series or resolve its premise for good; ' +\n        'each episode is a self-contained story with its own beginning and end.'\n    },\n    {\n      role: 'user',\n      content:\n        'Series: ' + String(r.name || '').trim().slice(0, 160) +\n        (String(r.premise || '').trim() ? '\\nWhat the show is: ' + String(r.premise).trim().slice(0, 1200) : '') +\n        (String(r.tone || '').trim() ? '\\nTone: ' + String(r.tone).trim().slice(0, 60) : '') +\n        (String(r.characters || '').trim() ? '\\nCharacters: ' + String(r.characters).trim().slice(0, 1200) : '') +\n        (String(r.places || '').trim() ? '\\nPlaces: ' + String(r.places).trim().slice(0, 1200) : '') +\n        (String(r.previously || '').trim()\n          ? '\\n\\nWHAT HAS HAPPENED SO FAR:\\n' + String(r.previously).trim().slice(0, 6000)\n          : '\\n\\nThis is the first episode after the one the show was started from.') +\n        (used.length ? '\\n\\nTITLES ALREADY USED (never repeat one):\\n' + used.slice(-20).join('\\n') : '') +\n        '\\n\\nPropose episode ' + episodeNo + '.'\n    }\n  ],\n  response_format: { type: 'json_object' }\n};\nreturn [{ json: { skip: false, series_id: String(r.id), episode_no: episodeNo, payload } }];" } },
});

const episodeModel = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'Episode Model', position: [900, 300], onError: 'continueRegularOutput',
    parameters: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify($json.payload) }}'), options: { timeout: 60000 } },
    credentials: { openAiApi: { id: 'oPGuXelJ6pnDePIs', name: 'OpenAI account' } },
  },
});

const parseEpisode = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Parse Episode', position: [1120, 300], parameters: { mode: 'runOnceForAllItems', jsCode: "// The model answers a JSON object because it was asked for one\n// (`response_format: json_object`), but a refusal, a timeout or a model that\n// decides to wrap it in prose all arrive here too, and the button must fail\n// as a dead button rather than as a broken page. Anything unreadable leaves\n// with no title, and the route turns that into \"nothing was changed\".\nconst asked = $('Build Episode Prompt').first().json;\nif (asked.skip) return [{ json: { title: null, idea: null } }];\nlet raw = '';\ntry { raw = String((($json.choices || [])[0] || {}).message?.content || ''); } catch (e) { raw = ''; }\nlet out = {};\ntry {\n  out = JSON.parse(raw);\n} catch (e) {\n  // A fenced or chatty answer: take the first {...} block and try once more.\n  const m = /\\{[\\s\\S]*\\}/.exec(raw);\n  try { out = m ? JSON.parse(m[0]) : {}; } catch (e2) { out = {}; }\n}\nconst clean = (v, max) => String(v == null ? '' : v).replace(/\\s+/g, ' ').trim().replace(/^[\"'“]+|[\"'”]+$/g, '').trim().slice(0, max);\nconst title = clean(out.title, 160);\nconst idea = clean(out.idea, 1200);\nif (!title) {\n  console.log('EPISODE EMPTY ' + asked.series_id + ': ' + JSON.stringify($json).slice(0, 300));\n  return [{ json: { title: null, idea: null } }];\n}\nconsole.log('EPISODE ' + asked.series_id + ' #' + asked.episode_no + ': ' + title);\nreturn [{ json: { title: title, idea: idea || null } }];" } },
});

// One reply, always. The alwaysOutputData on Load Series and the skip item
// in Build Episode Prompt exist so that an unknown id still reaches this
// node: a webhook that never responds is a button that spins for
// seventy-five seconds and then reports a network error.
const respondEpisode = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Episode', position: [1340, 300], parameters: { respondWith: 'json', responseBody: expr('{{ { title: $json.title || null, idea: $json.idea || null } }}') } },
});

export default workflow('series-next', 'Series Next')
  .add(nextWebhook)
  .to(loadSeries)
  .to(buildEpisodePrompt)
  .to(episodeModel)
  .to(parseEpisode)
  .to(respondEpisode);
