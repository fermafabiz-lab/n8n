// Composes series-next.workflow.js from the paste/ files, which are the source
// of truth for every node body (CLAUDE.md: a Code-node body or prompt edited
// through MCP must come from a committed file). Run, then hand the output to
// validate_workflow + create_workflow_from_code.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const paste = (name) => readFileSync(join(here, 'paste', name), 'utf8').trim();
const j = (s) => JSON.stringify(s);

const code = `import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

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
    parameters: { operation: 'executeQuery', query: ${j(paste('Load Series.sql'))}, options: { queryReplacement: expr('{{ [String($json.body.series_id || "")] }}') } },
    credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } },
  },
});

const buildEpisodePrompt = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Episode Prompt', position: [680, 300], parameters: { mode: 'runOnceForAllItems', jsCode: ${j(paste('Build Episode Prompt.js'))} } },
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
  config: { name: 'Parse Episode', position: [1120, 300], parameters: { mode: 'runOnceForAllItems', jsCode: ${j(paste('Parse Episode.js'))} } },
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
`;
writeFileSync(join(here, 'series-next.workflow.js'), code);
process.stdout.write(code);
