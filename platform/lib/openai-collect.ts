import {
  getExecutionWithData,
  listExecutions,
  listWorkflowsWithNodes,
  n8nConfigured,
} from "@/lib/n8n";
import { callsOf, callsOpenAi, type Execution } from "@/lib/openai-usage";
import { openAiLedgerReady, saveOpenAiScan, scannedExecutions } from "@/lib/data/postgres";

/**
 * Fill the OpenAI ledger (db/019) from n8n: every FINISHED execution of every
 * workflow that can call OpenAI, read once, its calls stored.
 *
 * Who runs it: the n8n "API Credits" workflow every hour (POST
 * /api/insights/openai with the shared key), and "Update now" on the usage
 * page. Each call works for at most `budgetMs` and says whether it got
 * through everything; the next one carries on, because every execution read
 * is written down (hov.openai_scan) and never read again.
 *
 * A run that is still going is left for later — its calls are counted when it
 * ends, which for a film's media pass can be hours. The page says so.
 */

/** How far back the ledger reaches. n8n keeps executions for a limited time anyway. */
export const LEDGER_DAYS = 31;

const FINISHED = new Set(["success", "error", "canceled", "crashed"]);

export interface CollectResult {
  ok: boolean;
  message: string;
  /** Executions read in this call. */
  read: number;
  /** OpenAI calls found in them. */
  calls: number;
  /** False when the time ran out before everything was read — call again. */
  done: boolean;
  ms: number;
}

const inFlight = globalThis as unknown as { hovOpenAiCollect?: Promise<CollectResult> };

/** One collection at a time per process: a second caller waits for the first. */
export function collectOpenAiUsage(opts: { budgetMs?: number } = {}): Promise<CollectResult> {
  if (!inFlight.hovOpenAiCollect) {
    inFlight.hovOpenAiCollect = run(opts.budgetMs ?? 45_000).finally(() => {
      inFlight.hovOpenAiCollect = undefined;
    });
  }
  return inFlight.hovOpenAiCollect;
}

async function run(budgetMs: number): Promise<CollectResult> {
  const t0 = Date.now();
  const result = (ok: boolean, message: string, read: number, calls: number, done: boolean): CollectResult => ({
    ok,
    message,
    read,
    calls,
    done,
    ms: Date.now() - t0,
  });
  if (!n8nConfigured) return result(false, "The n8n API is not configured (N8N_API_URL / N8N_API_KEY).", 0, 0, true);
  if (!(await openAiLedgerReady())) return result(false, "The ledger table is not there yet (db/019).", 0, 0, true);

  const since = Date.now() - LEDGER_DAYS * 86_400_000;
  const workflows = (await listWorkflowsWithNodes()).filter(callsOpenAi);
  let read = 0;
  let calls = 0;
  for (const wf of workflows) {
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) {
      const { data, nextCursor } = await listExecutions({ workflowId: wf.id, cursor, limit: 100 });
      const candidates = data.filter(
        (e) => FINISHED.has(e.status) && e.startedAt && Date.parse(e.startedAt) >= since,
      );
      const known = await scannedExecutions(candidates.map((e) => Number(e.id)));
      for (const e of candidates) {
        if (known.has(Number(e.id))) continue;
        if (Date.now() - t0 > budgetMs) {
          return result(true, `Read ${read} runs (${calls} OpenAI calls); more to read — time ran out.`, read, calls, false);
        }
        const got = await getExecutionWithData(e.id);
        const found = got.ok ? callsOf(got.execution as Execution, wf) : [];
        await saveOpenAiScan(
          {
            executionId: Number(e.id),
            workflowId: wf.id,
            status: e.status,
            startedAt: e.startedAt,
            note: got.ok ? "" : got.reason,
          },
          found,
        );
        read++;
        calls += found.length;
      }
      const oldest = data.at(-1)?.startedAt;
      cursor = nextCursor;
      if (!cursor || !oldest || Date.parse(oldest) < since) break;
    }
  }
  return result(true, read ? `Read ${read} runs, found ${calls} OpenAI calls. Up to date.` : "Up to date.", read, calls, true);
}
