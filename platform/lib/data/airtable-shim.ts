/**
 * The data half of the Airtable-shaped API. See app/api/at/[...path]/route.ts
 * for why it exists.
 *
 * Everything here reads and writes through the same `at_*` views and functions
 * the ported Postgres nodes use, so the two paths cannot disagree about what a
 * record looks like.
 */

import { atQuery } from "./postgres";

/** Both the table ids the URLs carry and the names two of them use. */
const ENTITY: Record<string, string> = {
  tbl0zT7ilefOqE3xk: "project",
  Proiecte: "project",
  tblkNIyOUeLnKqako: "scene",
  Scene: "scene",
  tbldVEFHiCyDVdQf9: "chapter",
  Capitole: "chapter",
  tblUueZa5ADA3A2rA: "script",
  Scripturi: "script",
  tblU26cUiQQV2eNdg: "evidence",
  Evidence: "evidence",
  tblfhYXhxMkCTfuRT: "genre_profile",
  "Genre Profiles": "genre_profile",
  tblRy8Qg0Vl9JXgAw: "script_library",
  "Script Library": "script_library",
};

function entityFor(table: string): string {
  const e = ENTITY[decodeURIComponent(table)];
  if (!e) throw new Error(`unknown table "${table}"`);
  return e;
}

export interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export async function atRead(table: string, id: string): Promise<AirtableRecord> {
  const entity = entityFor(table);
  const rows = await atQuery<AirtableRecord>(
    `select id, "createdTime", fields from hov.at_${entity} where id = $1`,
    [id],
  );
  if (!rows[0]) throw new Error(`record ${id} not found`);
  return rows[0];
}

/**
 * Airtable's formulas, translated by shape.
 *
 * Only the four the workflows actually send are recognised, and anything else
 * throws rather than being approximated. A general translator would be a large
 * piece of guesswork for a known, small input — and a wrong guess here silently
 * returns the wrong scenes.
 */
function whereFor(formula: string | null): { sql: string; params: unknown[] } {
  if (!formula || !formula.trim()) return { sql: "", params: [] };
  const f = formula.trim();

  // {Project_ID}='rec…'  — IR Load Siblings, VR Load All Scenes
  let m = f.match(/^\{Project_ID\}\s*=\s*'([^']*)'$/);
  if (m) return { sql: `where fields->>'Project_ID' = $1`, params: [m[1]] };

  // AND({Active}=1, LOWER({Tone})='x')  — Fetch Genre Profile
  m = f.match(/^AND\(\{Active\}\s*=\s*1,\s*LOWER\(\{Tone\}\)\s*=\s*'(.*)'\)$/s);
  if (m) {
    return {
      sql: `where (fields->>'Active')::boolean and lower(fields->>'Tone') = $1`,
      // The node lower-cases and escapes quotes before sending; undo the escape.
      params: [m[1].replace(/\\'/g, "'")],
    };
  }

  // AND({Active}=1, OR({Tone}='x', {Category}='x'))  — Fetch Style Card
  m = f.match(
    /^AND\(\{Active\}\s*=\s*1,\s*OR\(\{Tone\}\s*=\s*'([^']*)',\s*\{Category\}\s*=\s*'([^']*)'\)\)$/s,
  );
  if (m) {
    return {
      sql: `where (fields->>'Active')::boolean
              and (fields->>'Tone' = $1 or fields->>'Category' = $2)`,
      params: [m[1], m[2]],
    };
  }

  throw new Error(`filterByFormula not recognised: ${f}`);
}

export async function atList(
  table: string,
  opts: { filterByFormula: string | null; maxRecords: number | null; pageSize: number | null },
): Promise<{ records: AirtableRecord[] }> {
  const entity = entityFor(table);
  const { sql, params } = whereFor(opts.filterByFormula);

  // Airtable caps at whichever of the two is smaller, and defaults to 100 —
  // which is also what the unpaginated callers here expect to be enough.
  const limit = Math.min(opts.maxRecords ?? 100, opts.pageSize ?? 100, 1000);

  const records = await atQuery<AirtableRecord>(
    `select id, "createdTime", fields from hov.at_${entity} ${sql}
      order by "createdTime" limit ${limit}`,
    params,
  );
  return { records };
}

export async function atWrite(
  table: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const entity = entityFor(table);
  if (!Object.keys(fields).length) return atRead(table, id);
  const rows = await atQuery<AirtableRecord>(
    `select * from hov.at_write($1, $2, $3::jsonb)`,
    [entity, id, JSON.stringify(fields)],
  );
  if (!rows[0]) throw new Error(`record ${id} not found`);
  return rows[0];
}

/**
 * Batch create, the shape `Save Evidence` posts.
 *
 * Airtable takes up to ten records per call and the node batches accordingly;
 * there is no reason to impose the same limit here, but there is every reason
 * to keep the response shape identical.
 */
export async function atCreateMany(
  table: string,
  records: Array<{ fields?: Record<string, unknown> }>,
): Promise<{ records: AirtableRecord[] }> {
  const entity = entityFor(table);
  const out: AirtableRecord[] = [];
  for (const r of records) {
    const rows = await atQuery<AirtableRecord>(
      `select * from hov.at_create($1, $2::jsonb)`,
      [entity, JSON.stringify(r.fields ?? {})],
    );
    if (rows[0]) out.push(rows[0]);
  }
  return { records: out };
}
