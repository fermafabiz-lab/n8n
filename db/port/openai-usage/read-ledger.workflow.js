import { workflow, node, trigger } from '@n8n/workflow-sdk';

// Fill the OpenAI ledger NOW, from a Claude session — the long first read of a
// month of runs, which the hourly node (API Credits → Read OpenAI Ledger, 120 s
// a time) would otherwise spread over several hours. The site does the work
// (it holds the n8n API key); this only knocks, with the shared key.
//
//   execute_workflow(id, 'manual')   — run it until the answer says done: true
//
// then archive it. Safe to repeat: every run already read is skipped.

const start = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Start', position: [240, 300] }, output: [{}] });

const read = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'POST /api/insights/openai',
    parameters: {
      method: 'POST',
      url: 'http://web:3000/api/insights/openai',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '{"budgetMs":270000}',
      options: { timeout: 290000, response: { response: { neverError: true, fullResponse: true } } }
    },
    credentials: { httpHeaderAuth: { id: '8kpY42LmZaBYBzfY', name: 'HOV Media Ingest' } },
    position: [540, 300]
  },
  output: [{}]
});

export default workflow('read-openai-ledger', 'zz read the OpenAI ledger (delete)')
  .add(start)
  .to(read);
