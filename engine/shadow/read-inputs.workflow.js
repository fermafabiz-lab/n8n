// Phase 3 throwaway: read, from the LIVE hov database, exactly what the
// engine's loadInputs() reads for a set of projects — the same three
// hov.at_* views and the same predicates (engine/src/db.ts) — in one
// read-only statement, one row per project. Created with the n8n MCP
// connector's create_workflow_from_code, run once with execute_workflow,
// archived after. It writes nothing. The SDK accepts no computed code, so the
// project list is written out: edit it in place to shadow other films.
import { workflow, node, trigger } from '@n8n/workflow-sdk';

const QUERY = `-- engine phase 3: loadInputs() for the five films Final Assembly 309157bd finished. Read-only.
select p.id as project_id,
  (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'createdTime', s."createdTime", 'fields', s.fields)), '[]'::jsonb)
     from hov.at_scene s
    where s.fields->>'Project_ID' = p.id and (s.fields->>'Aprobare Scenă')::boolean) as scene_rows,
  (select jsonb_build_object('id', ap.id, 'createdTime', ap."createdTime", 'fields', ap.fields)
     from hov.at_project ap where ap.id = p.id) as project,
  (select jsonb_build_object('id', sc.id, 'createdTime', sc."createdTime", 'fields', sc.fields)
     from hov.at_script sc
    where sc.fields->'Associated Project' @> jsonb_build_array(p.id)
    order by sc."createdTime" desc limit 1) as script
from hov.project p
where p.id in ('recq9Ttq2izgGB5lJ', 'recIIvYV8S6KNaw4C', 'rec0w52EKvBoBlBLF', 'rec7U8PbMS8MUYQcW', 'rec0LeBDrX03PDGAj')`;

const start = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Start', position: [240, 300] }, output: [{}] });

const read = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: {
    name: 'Read Engine Inputs',
    parameters: { operation: 'executeQuery', query: QUERY, options: {} },
    credentials: { postgres: { id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres' } },
  },
  output: [{}],
});

export default workflow('engine-shadow-read', 'zz engine shadow: read inputs (read-only)')
  .add(start)
  .to(read);
