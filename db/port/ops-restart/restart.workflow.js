import { workflow, node, trigger } from '@n8n/workflow-sdk';

// "Restart the films that are being worked on" — from a Claude session, which
// cannot stop an n8n execution itself (db/port/ops-restart/README.md).
//
// A throwaway: create it, run it once per film with
//   execute_workflow(id, 'manual', { type: 'webhook', webhookData: { method: 'POST', body: { projectId: 'rec…' } } })
// judge it by the NEW executions it starts (search_executions), then archive it.
// The call itself may come back canceled: Pause stops every running execution,
// this one included, and the restart finishes on the site regardless.

const start = trigger({
  type: 'n8n-nodes-base.webhook', version: 2,
  config: { name: 'Film to restart', parameters: { httpMethod: 'POST', path: 'zz-ops-restart', responseMode: 'onReceived', options: {} }, position: [240, 300] },
  output: [{ body: { projectId: 'recABCDEFGHIJKLMN' } }]
});

const restart = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'POST /api/ops/restart',
    parameters: {
      method: 'POST',
      url: 'http://web:3000/api/ops/restart',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ projectId: $json.body.projectId }) }}',
      options: { timeout: 60000, response: { response: { neverError: true, fullResponse: true } } }
    },
    credentials: { httpHeaderAuth: { id: '8kpY42LmZaBYBzfY', name: 'HOV Media Ingest' } },
    position: [540, 300]
  },
  output: [{}]
});

export default workflow('ops-restart', 'zz ops restart a film (delete)')
  .add(start)
  .to(restart);
