// Composes graphic-plan.workflow.js from the paste/ files, which are the
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

// Graphic Plan — which graphic style a film gets and what its graphics say.
// POST {project_id} lands here from the site once a film's scene texts are
// approved, and from the "Choose again" button in Final touches (fire-and-
// forget). Story and Documentary only. Writes Editing Options.graphicPlan;
// Final Assembly's Caption Colour node turns it into render props.
// db/port/graphic-styles/ and db/port/transitions/.

const planWebhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Plan Webhook', position: [240, 300], parameters: { httpMethod: 'POST', path: 'graphic-plan', responseMode: 'onReceived' } },
});

const loadFilm = node({
  type: 'n8n-nodes-base.postgres', version: 2.7,
  config: {
    name: 'Load Film', position: [460, 300],
    parameters: { operation: 'executeQuery', query: ${j(paste('Load Film.sql'))}, options: { queryReplacement: expr('{{ [String($json.body.project_id || "")] }}') } },
    credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } },
  },
});

const buildPlanPrompt = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Plan Prompt', position: [680, 300], parameters: { mode: 'runOnceForAllItems', jsCode: ${j(paste('Build Plan Prompt.js'))} } },
});

const planModel = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'Plan Model', position: [900, 300], onError: 'continueRegularOutput',
    parameters: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify($json.payload) }}'), options: { timeout: 180000 } },
    credentials: { openAiApi: { id: 'oPGuXelJ6pnDePIs', name: 'OpenAI account' } },
  },
});

const parsePlan = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Parse Plan', position: [1120, 300], parameters: { mode: 'runOnceForAllItems', jsCode: ${j(paste('Parse Plan.js'))} } },
});

const savePlan = node({
  type: 'n8n-nodes-base.postgres', version: 2.7,
  config: {
    name: 'Save Plan', position: [1340, 300],
    parameters: { operation: 'executeQuery', query: ${j(paste('Save Plan.sql'))}, options: { queryReplacement: expr('{{ [$json.plan_b64, $json.project_id] }}') } },
    credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } },
  },
});

export default workflow('graphic-plan', 'Graphic Plan')
  .add(planWebhook)
  .to(loadFilm)
  .to(buildPlanPrompt)
  .to(planModel)
  .to(parsePlan)
  .to(savePlan);
`;
writeFileSync(join(here, 'graphic-plan.workflow.js'), code);
console.log('wrote graphic-plan.workflow.js');
