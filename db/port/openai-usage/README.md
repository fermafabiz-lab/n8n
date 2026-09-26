# The OpenAI ledger — what used the credits, call by call (2026-09-26)

The ask, verbatim: *"La zona de analytics aș vrea să fie lucrurile puțin mai
clare. În primul rând, aș vrea la fiecare grafic să existe un titlu ca să știu
la ce mă uit ("ElevenLabs Credits/video", etc). În al doilea rând aș vrea la
OpenAI să am mult mai multe informații pt că după ultima încărcare ni s-au dus
creditele foarte repede și aș vrea să știu ce a consumat și cât (printre altele
ar fi bun un pie chart)."*

Two things: a title on every chart of `/admin/insights/usage`, and — the real
work — an answer to "what used the OpenAI credits since the top-up, and how
much".

## Why OpenAI cannot answer it (measured, execution 17685)

| asked of OpenAI with the key n8n holds | answer |
|---|---|
| `GET /v1/responses` (the request log the dashboard shows) | 401 "must be made with a session key … from the browser" |
| `GET /v1/chat/completions` (stored completions) | 200, **empty** — nothing is sent with `store: true` |
| `GET /v1/organization/usage/completions` | 403 "Missing scopes: api.usage.read" |
| `GET /v1/organization/costs` | 403, same scope (already probed hourly since 2026-09-24) |

And even WITH `api.usage.read`, OpenAI groups by model, key, project — never by
pipeline step. Two agents on gpt-5.4 are one line on its bill.

## Where the answer is: n8n's own executions

Every finished execution keeps what each node did, and the two kinds of OpenAI
call leave different traces:

| call | what n8n keeps | in the ledger |
|---|---|---|
| raw **HTTP Request** to api.openai.com (Rewrite Scene Text / Standalone, Rewrite Script, Motion Judge, RG Motion Judge, Consistency Judge, VP Rewrite AI, Rewrite Prompt AI, Graphic Plan's Plan Model) | OpenAI's own reply, `usage` included (prompt, cached, completion, reasoning) | **measured** |
| **model sub-node** (`lmChatOpenAi`) feeding an agent (all of Claude Scripting's writing, Deep Search) | n8n's `tokenUsageEstimate` — the prompt as n8n counted it, and the answer's text | **estimated** |

Two traps in the second row, both found in execution 17677:

- **An agent with an output parser answers through a TOOL CALL**
  (`format_final_json_response`), so the model run's text is `""` and n8n counts
  the answer as **0 tokens**. `Segment Chapter Into Scenes` recorded 5,761 prompt
  tokens and 0 completion, while its agent output was 12,223 characters. At
  gpt-5.4's $15 per million output tokens, against $2.50 input, that zero hid
  most of the cost. The ledger measures such an answer off the AGENT's output
  (`source[0].previousNode` + `previousNodeRun` name the agent run; one output
  item per model call when they pair up, shared evenly when they do not).
- **The model run names the agent that asked**: `source[0].previousNode`. That
  is the "step" — `Editor Model` serves seven agents (the narration editor and
  six Deep Search steps), so the model node's own name says almost nothing.

What n8n does NOT keep, and so the ledger cannot count: **web searches**.
`Research Model` and `Story Bible Model` have OpenAI's built-in web search on,
context size **high** — $10 per 1,000 searches plus every page read, billed as
input. n8n records neither the searches nor the pages. The page says so under
the figures, and marks those steps "web search"; OpenAI's measured total (once
the key has *Usage → Read*) is the number that includes them.

## Prices

Standard tier, read from `https://developers.openai.com/api/docs/pricing.md` on
2026-09-26 (fetched through n8n — the session's proxy blocks that host):
gpt-5.4 $2.50 in / $0.25 cached / $15.00 out per million (over 272K input:
$5 / $0.50 / $22.50), gpt-4o $2.50 / $1.25 / $10, gpt-4o-mini $0.15 / $0.075 /
$0.60, web search $10 per 1k calls. `platform/lib/openai-usage.ts` `PRICES`
carries them with the date; the cost is stored per call at collection time, so
a later price change does not rewrite history.

## The pieces

| piece | where |
|---|---|
| the parse | `platform/lib/openai-usage.ts` — `callsOf(execution, workflow)`, `filmOf`, prices, the six families, `summarize` |
| the reading | `platform/lib/openai-collect.ts` — every workflow that can call OpenAI (`callsOpenAi`), every FINISHED execution of the last 31 days not yet read, one at a time, inside a time budget |
| the store | `hov.openai_call` + `hov.openai_scan` — **`db/019_openai_usage.sql`**, applied live in execution **17697** |
| the door | `POST /api/insights/openai` (`x-hov-key` = `MEDIA_INGEST_KEY`), key-gated in `middleware.ts` |
| hourly | n8n "API Credits" `Bkuo0qIxKprUFVpU`, node **Read OpenAI Ledger** on its own branch from `Every Hour` (120 s budget — the workflow's `executionTimeout` is 180 s), version `2cbef392` |
| on demand | "⟳ Update now" on the usage page (`readOpenAiUsageNow`, 25 s) |
| a long first read | `read-ledger.workflow.js` — a throwaway, 270 s a run |
| the page | `/admin/insights/usage`: OpenAI first; "Since the OpenAI top-up" as a period (the last out → ok in `hov.api_balance`); pies by pipeline step and by model; dollars per day; every step ranked; dollars per film |

A run still going is not read — its calls count when it ends, which for a
film's media pass can be hours.

## The six families (the pie)

Research before writing (`Research Tema`) · Writing the script (bible, outline,
narration, editor, scenes, hook, drawn cards, cinematic, rewrite with feedback)
· Deep Search (`FC *`, `DS *`) · Scene and hook rewrites · Clip checks and
prompt fixes (Media Generation's judges and prompt rewrites) · Everything else.
A pie past six slices cannot be read; the step table carries the detail.

## Verified

- `npm run check:openai-usage` (77): the parse against the two real executions
  in `fixtures/` (sanitised — prompts trimmed, model options reduced to model +
  baseURL, no key reference), the prices, the families, the page's joints.
- `browser/drive.mjs` (37): the production build on a real Postgres engine with
  a stand-in n8n serving those executions — the door shut without the key, the
  two finished runs read and the running one left, the page's titles, pies,
  keyboard and pointer answers, the table twins, 390 px dark, and the
  several-films restart (every run stopped once, both films resumed).

## The restart door takes several films (same change)

`POST /api/ops/restart {"projectIds": [...]}` → `restartProductions`: one Pause,
then the full Resume for the first film and the bare webhook for the rest.
Calling the door once per film cannot work — the second Pause stops the run the
first Resume started, and the second Resume refuses because that run is alive.
`../ops-restart/restart.workflow.js` sends the list.
