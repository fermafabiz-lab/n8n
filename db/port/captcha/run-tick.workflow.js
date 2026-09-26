import { workflow, node, trigger } from '@n8n/workflow-sdk';

// Run the site's hourly tick NOW, from a Claude session — the first one, which
// back-fills a month of useapi's captcha record into hov.captcha_day, records
// CapSolver's balance (or that the key is missing) and reads the OpenAI ledger.
// The hourly node (API Credits → Insights Tick, 120 s a time) would otherwise
// spread the back-fill over the next hours. The site does the work (it holds
// the keys); this only knocks, with the shared key.
//
//   execute_workflow(id, 'manual')   — read `captcha.done`; repeat until true
//
// then archive it. Safe to repeat: a complete day is never read twice.

const start = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Start', position: [240, 300] }, output: [{}] });

const tick = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'POST /api/insights/tick',
    parameters: {
      method: 'POST',
      url: 'http://web:3000/api/insights/tick',
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

export default workflow('run-insights-tick', 'zz run the insights tick (delete)')
  .add(start)
  .to(tick);
