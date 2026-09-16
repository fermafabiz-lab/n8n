// Composes series-recap.workflow.js from the paste/ files, which are the
// source of truth for every node body (CLAUDE.md: a Code-node body or query
// edited through MCP must come from a committed file). Run, then hand the
// output to validate_workflow + create_workflow_from_code.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const paste = (name) => readFileSync(join(here, 'paste', name), 'utf8').trim();
const j = (s) => JSON.stringify(s);

const code = `import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

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
    parameters: { operation: 'executeQuery', query: ${j(paste('Load Episode.sql'))}, options: { queryReplacement: expr('{{ [String($json.body.project_id || "")] }}') } },
    credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } },
  },
});

const buildRecapPrompt = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Recap Prompt', position: [680, 300], parameters: { mode: 'runOnceForAllItems', jsCode: ${j(paste('Build Recap Prompt.js'))} } },
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
  config: { name: 'Parse Recap', position: [1120, 300], parameters: { mode: 'runOnceForAllItems', jsCode: ${j(paste('Parse Recap.js'))} } },
});

const appendRecap = node({
  type: 'n8n-nodes-base.postgres', version: 2.7,
  config: {
    name: 'Append Recap', position: [1340, 300],
    parameters: { operation: 'executeQuery', query: ${j(paste('Append Recap.sql'))}, options: { queryReplacement: expr('{{ [$json.line_b64, $json.series_id, $json.like_pattern] }}') } },
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
`;
writeFileSync(join(here, 'series-recap.workflow.js'), code);
process.stdout.write(code);
