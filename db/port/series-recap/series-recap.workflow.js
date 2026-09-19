import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

// Series Recap — the pipeline writes "what has happened so far" itself.
// POST {project_id} lands here from approveScript on the site (fire-and-
// forget, 8 s timeout, only for a project that is an episode). The chain
// loads the approved narration, asks gpt-5.4 for two sentences, and
// replaces-or-appends one line on series.previously. Nothing waits on it:
// the webhook answers 200 on receipt. A project that is not an episode
// stops at Load Episode with zero rows.

const recapWebhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Recap Webhook', position: [240, 300], parameters: { httpMethod: 'POST', path: 'series-recap', responseMode: 'onReceived' } },
});

const loadEpisode = node({
  type: 'n8n-nodes-base.postgres', version: 2.7,
  config: {
    name: 'Load Episode', position: [460, 300],
    parameters: { operation: 'executeQuery', query: "-- One row when the project is an episode of a series, none otherwise —\n-- and none is the correct answer for every ordinary film: the chain simply\n-- does not run. The narration is the NEWEST row of hov.script for the\n-- project, the same rule as getProjectScriptInfo in\n-- platform/lib/data/postgres.ts — it is the row approveScript has just\n-- written \"Script Content\" and Status = approved onto. (project's own\n-- full_narrator_script / edited_narrator_script are empty on every film\n-- since the cutover; nothing writes them.)\nselect p.id,\n       p.name,\n       p.series_id,\n       coalesce(p.episode_no, 0) as episode_no,\n       coalesce(nullif(p.language, ''), nullif(s.language, ''), 'English') as language,\n       coalesce((select sc.content\n                   from hov.script sc\n                  where sc.project_id = p.id\n                  order by sc.created_at desc\n                  limit 1), '') as script,\n       s.name as series_name,\n       s.premise,\n       s.previously\n  from hov.project p\n  join hov.series s on s.id = p.series_id\n where p.id = $1", options: { queryReplacement: expr('{{ [String($json.body.project_id || "")] }}') } },
    credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } },
  },
});

const buildRecapPrompt = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Recap Prompt', position: [680, 300], parameters: { mode: 'runOnceForAllItems', jsCode: "// What happened in this episode, asked of the model from the approved\n// narration. Nothing else is in the prompt: not the bible, not the earlier\n// recap — the line has to stand on its own, because it is read later by a\n// writer who has the bible separately and must not be told the same thing\n// twice. The script is capped well above the longest film (an 8-minute one\n// is ~7,000 characters) so a runaway paste cannot cost a fortune.\nconst r = $json;\nconst script = String(r.script || '').trim();\nconst episodeNo = Number(r.episode_no) || 0;\nif (!script || script.length < 80 || !episodeNo || !r.series_id) {\n  console.log('RECAP SKIP ' + String(r.id || '?') + ': ' + (!r.series_id ? 'not an episode' : !episodeNo ? 'no episode number' : 'no approved script'));\n  return [];\n}\nconst language = String(r.language || 'English').trim().slice(0, 40) || 'English';\nconst title = String(r.name || '').trim().slice(0, 160);\nconst payload = {\n  model: 'gpt-5.4',\n  messages: [\n    {\n      role: 'system',\n      content:\n        'You keep the running recap of an episodic series of short films. From the narration of ONE episode, write what happened in it: the events, who did what, and how it ended. ' +\n        // 100, not the 60 this asked for until 2026-09-19. The model had been\n        // ignoring 60 and writing about 100 anyway, so the instruction was\n        // describing something that was not happening — and the longer line is\n        // the better one for the job: the next episode's writer reads this to\n        // avoid contradicting and avoid retelling, and neither is possible if\n        // the events are not named. The cost is measured, not guessed: a line\n        // runs ~590 characters against ~400 at 60 words, so composeSeriesLore's\n        // 8,000-character Lore cap starts trimming the OLDEST lines at about\n        // episode 13 instead of about 20. Trimming is oldest-first and keeps\n        // the newest, so it degrades gently; revisit before a show gets there.\n        'Two sentences, at most 100 words, in ' + language + ', in the past tense. ' +\n        'Use the characters\\' names exactly as the narration spells them. State only what the narration says: no interpretation, no moral, no praise, no preamble, no quotes, no headings, no line breaks.'\n    },\n    {\n      role: 'user',\n      content:\n        'Series: ' + String(r.series_name || '').trim().slice(0, 160) +\n        (String(r.premise || '').trim() ? '\\nPremise: ' + String(r.premise).trim().slice(0, 1200) : '') +\n        '\\nEpisode ' + episodeNo + ': ' + (title || 'Untitled') +\n        '\\n\\nNARRATION:\\n' + script.slice(0, 30000)\n    }\n  ]\n};\nreturn [{ json: { project_id: String(r.id), series_id: String(r.series_id), episode_no: episodeNo, title: title || 'Untitled', payload } }];" } },
});

const recapModel = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'Recap Model', position: [900, 300], onError: 'continueRegularOutput',
    parameters: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify($json.payload) }}'), options: { timeout: 120000 } },
    credentials: { openAiApi: { id: 'oPGuXelJ6pnDePIs', name: 'OpenAI account' } },
  },
});

const parseRecap = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Parse Recap', position: [1120, 300], parameters: { mode: 'runOnceForAllItems', jsCode: "// One line per episode, always in the same shape — `Episode N — Title:\n// summary` — because the shape is the key. Append Recap drops any earlier\n// line for the same episode number before adding this one, so approving\n// the script twice (an edit, hands-off mode) REPLACES the line rather\n// than doubling it. Base64 because the line is free text from a model and\n// a Postgres node must never see a dollar sign followed by a digit in its\n// query text (CLAUDE.md, \"Cross-cutting gotchas\").\nconst asked = $('Build Recap Prompt').first().json;\nlet raw = '';\ntry { raw = String((($json.choices || [])[0] || {}).message?.content || ''); } catch (e) { raw = ''; }\nraw = raw.replace(/\\s+/g, ' ').trim().replace(/^[\"'“]+|[\"'”]+$/g, '').trim();\nif (!raw || raw.length < 20) {\n  console.log('RECAP EMPTY ' + asked.project_id + ': ' + JSON.stringify($json).slice(0, 300));\n  return [];\n}\n// This has to clear the word cap in Build Recap Prompt or it silently cuts a\n// sentence in half, which is the worse failure: a truncated recap still reads\n// as a recap. At 100 words a real line measured ~523 characters of summary, so\n// 600 was about to start chopping; 800 leaves room for a long one and still\n// stops a runaway. Move the two together.\nconst summary = raw.slice(0, 800);\nconst line = 'Episode ' + asked.episode_no + ' — ' + asked.title.replace(/[\\r\\n]+/g, ' ') + ': ' + summary;\nconsole.log('RECAP ' + asked.project_id + ': ' + line);\nreturn [{ json: {\n  project_id: asked.project_id,\n  series_id: asked.series_id,\n  line,\n  line_b64: Buffer.from(line, 'utf8').toString('base64'),\n  // `Episode N —%`: the space-dash after the number is what keeps\n  // \"Episode 1\" from matching \"Episode 10\".\n  like_pattern: 'Episode ' + asked.episode_no + ' —%',\n} }];" } },
});

const appendRecap = node({
  type: 'n8n-nodes-base.postgres', version: 2.7,
  config: {
    name: 'Append Recap', position: [1340, 300],
    parameters: { operation: 'executeQuery', query: "-- One statement, so two episodes approved in the same minute cannot lose\n-- each other's line: every existing line for THIS episode number goes,\n-- the new one is appended, blank lines are dropped. The parameters are the\n-- line (base64), the series id, and the LIKE pattern for this episode's\n-- line — in that order. They are positional on purpose: pg-promise\n-- substitutes them TEXTUALLY, comments included, so a comment must not\n-- name one.\nupdate hov.series\n   set previously = btrim(\n         array_to_string(array(\n           select l\n             from unnest(string_to_array(previously, E'\\n')) as l\n            where l not like $3\n              and btrim(l, E' \\t\\r') <> ''\n         ), E'\\n')\n         || E'\\n' || convert_from(decode($1, 'base64'), 'UTF8'),\n         E'\\n')\n where id = $2\nreturning id, length(previously) as previously_length", options: { queryReplacement: expr('{{ [$json.line_b64, $json.series_id, $json.like_pattern] }}') } },
    credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } },
  },
});

export default workflow('series-recap', 'Series Recap')
  .add(recapWebhook)
  .to(loadEpisode)
  .to(buildRecapPrompt)
  .to(recapModel)
  .to(parseRecap)
  .to(appendRecap);
