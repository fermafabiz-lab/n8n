import { workflow, node, trigger } from '@n8n/workflow-sdk';

// What ONE research call with web search really costs — the part of the bill
// n8n never records (db/port/openai-usage/README.md, "what n8n does NOT keep").
//
// Claude Scripting's `Research Model` and `Story Bible Model` run gpt-5.4 with
// OpenAI's built-in web search, context size HIGH. Through the agent, n8n keeps
// only its own estimate of the prompt and the answer; the searches ($10 per
// 1,000) and every page they read (billed as input) are invisible. This asks
// the same kind of question straight to the Responses API, where the reply's
// `usage` counts everything, and prices it. One paid call, a few cents to a
// few tens of cents: run once, read `Measure`, archive.

const start = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Start', position: [240, 300] }, output: [{}] });

const ask = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Question',
    parameters: {
      jsCode: "const topic = 'How Rome fed a million people';\nconst prompt = [\n  'You are a meticulous research assistant preparing background notes for a documentary narrative about this topic:',\n  '',\n  'TOPIC: ' + topic,\n  '',\n  'WHAT TO RESEARCH FOR THIS GENRE:',\n  'The real history: what happened, when, where, who, with numbers, dates and names that are public.',\n  '',\n  'You MUST use the web search tool NOW and gather the information before writing anything.',\n  '',\n  'Output TWO sections: NOTES (max 350 words, bullet points, ending with a line UNVERIFIED/UNKNOWN:) and CLAIMS (10-20 lines, each: CLAIM: <sentence> | SOURCE: <site> | URL: <link> | DATE: <date or n/a>).',\n].join('\\n');\nreturn [{ json: { req: { model: 'gpt-5.4', tools: [{ type: 'web_search', search_context_size: 'high' }], input: prompt } } }];"
    },
    position: [480, 300]
  },
  output: [{ req: {} }]
});

const call = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'Responses API',
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/responses',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.req) }}',
      options: { timeout: 600000, response: { response: { neverError: true, fullResponse: true } } }
    },
    credentials: { openAiApi: { id: 'oPGuXelJ6pnDePIs', name: 'OpenAI account' } },
    position: [720, 300]
  },
  output: [{}]
});

const measure = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Measure',
    parameters: {
      jsCode: "const r = $json.body || {};\nconst u = r.usage || {};\nconst out = Array.isArray(r.output) ? r.output : [];\nconst searches = out.filter((o) => o && o.type === 'web_search_call').length;\nconst input = u.input_tokens || 0;\nconst cached = (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;\nconst output = u.output_tokens || 0;\nconst reasoning = (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0;\nconst long = input > 272000;\nconst p = long ? { i: 5, c: 0.5, o: 22.5 } : { i: 2.5, c: 0.25, o: 15 };\nconst tokensUsd = ((input - cached) * p.i + cached * p.c + output * p.o) / 1e6;\nconst searchUsd = searches * 0.01;\nreturn [{ json: { status: $json.statusCode, model: r.model, searches, input, cached, output, reasoning, tokensUsd: Math.round(tokensUsd * 10000) / 10000, searchUsd, totalUsd: Math.round((tokensUsd + searchUsd) * 10000) / 10000, error: r.error ? (r.error.message || r.error) : null } }];"
    },
    position: [960, 300]
  },
  output: [{}]
});

export default workflow('probe-web-search', 'zz what a web-search call costs (delete)')
  .add(start)
  .to(ask)
  .to(call)
  .to(measure);
