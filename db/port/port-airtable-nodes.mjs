/**
 * Converts the Airtable nodes in a workflow into Postgres nodes that speak to
 * the compatibility layer (db/002_airtable_compat.sql).
 *
 *   node port-airtable-nodes.mjs <workflow.json> [--write]
 *
 * Without --write it prints what it would change and touches nothing.
 *
 * WHY A SCRIPT AND NOT FORTY-EIGHT EDITS
 *
 * The conversion is mechanical — an Airtable node's table becomes an entity,
 * its column mapping becomes a JSON object literal, its filter becomes a WHERE
 * clause — and mechanical work done by hand forty-eight times over, in files
 * where a mistyped diacritic silently breaks an approval gate, is how this
 * migration would acquire the bugs it is supposed to avoid. A script is also
 * reviewable: run it twice, diff the output, and the transformation itself is
 * what gets checked rather than each of its results.
 *
 * WHAT IT DELIBERATELY WILL NOT DO
 *
 * Four nodes write attachments — `"Imagine Scenă": [{url}]` — and relied on
 * Airtable going and fetching those bytes. That download is the one thing the
 * database cannot do. Converting them by dropping the attachment field would
 * leave a scene looking generated with nothing behind it, so the script
 * REFUSES them and names them instead. They need a download chain, built
 * separately.
 */

import { readFileSync, writeFileSync } from "node:fs";

const AIRTABLE_TYPE = "n8n-nodes-base.airtable";
const PG_CRED = { id: "eRjiNDQFuDSTJpGK", name: "HOV Postgres" };

const ENTITY_BY_TABLE = {
  tbl0zT7ilefOqE3xk: "project",
  tblkNIyOUeLnKqako: "scene",
  tbldVEFHiCyDVdQf9: "chapter",
  tblUueZa5ADA3A2rA: "script",
};

const ATTACHMENT_FIELDS = ["Imagine Scenă", "Video Scenă", "Versiuni Imagine"];

/** `={{ expr }}` → `expr`; a literal stays a literal. */
const isExpr = (v) => typeof v === "string" && v.startsWith("=");
const exprBody = (v) => String(v).slice(1);

/**
 * Dollar-quoting, so nothing in the data has to be escaped.
 *
 * n8n resolves {{ }} inside the query text, and the resolved value can carry
 * apostrophes, quotes, newlines, `$` and diacritics — all of which broke
 * ordinary quoting and none of which trouble $hov$…$hov$.
 */
const dq = (inner) => `$hov$${inner}$hov$`;

/** An n8n expression, stripped of its `=` marker, ready to sit inside SQL. */
function inlineExpr(value) {
  if (isExpr(value)) {
    const body = exprBody(value).trim();
    // Already a bare {{ … }} template: drop it in as-is.
    if (body.startsWith("{{") && body.endsWith("}}")) return body;
    return `{{ ${body} }}`;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Query builders, one per Airtable operation
// ---------------------------------------------------------------------------

const READ_COLS = 'id, "createdTime", fields';

function buildGet(entity, params) {
  return `select ${READ_COLS} from hov.at_${entity}\nwhere id = ${dq(inlineExpr(params.id))}`;
}

/**
 * The thirteen search nodes use four filters between them. Each is recognised
 * by shape rather than parsed: a general Airtable-formula-to-SQL translator
 * would be a large piece of guesswork for four known inputs.
 */
function buildSearch(entity, params, nodeName) {
  const f = String(params.filterByFormula ?? "").trim();
  const where = translateFilter(f, nodeName);
  return `select ${READ_COLS} from hov.at_${entity}\n${where}`;
}

function translateFilter(f, nodeName) {
  if (!f) return ""; // no filter: whole table, same as Airtable

  // AND({Project_ID}='<expr>', {Aprobare Scenă}=1)
  let m = f.match(
    /^=\{\{\s*"AND\(\{Project_ID\}='"\s*\+\s*(.+?)\s*\+\s*"',\s*\{Aprobare Scenă\}=1\)"\s*\}\}$/,
  );
  if (m) {
    return (
      `where fields->>'Project_ID' = ${dq(`{{ ${m[1]} }}`)}\n` +
      `  and (fields->>'Aprobare Scenă')::boolean`
    );
  }

  // OR(RECORD_ID()='a', RECORD_ID()='b', …) built by mapping a node's output.
  // Rebuilt as one comma-joined string rather than N literals: same source
  // expression, and the id list stays a single value however long it gets.
  m = f.match(
    /^=\{\{\s*"OR\("\s*\+\s*(.+?)\.all\(\)\.map\(\s*(\w+)\s*=>\s*"RECORD_ID\(\)='"\s*\+\s*\2\.json\.id\s*\+\s*"'"\s*\)\.join\(","\)\s*\+\s*"\)"\s*\}\}$/,
  );
  if (m) {
    const [, source, v] = m;
    return `where id = any(string_to_array(${dq(
      `{{ ${source}.all().map(${v} => ${v}.json.id).join(",") }}`,
    )}, ','))`;
  }

  // {Field}='value'
  m = f.match(/^\{([^}]+)\}\s*=\s*'([^']*)'$/);
  if (m) return `where fields->>${sqlLit(m[1])} = ${sqlLit(m[2])}`;

  // OR({Field}='a',{Field}='b', …) over one field
  m = f.match(/^OR\((.+)\)$/);
  if (m) {
    const parts = [...m[1].matchAll(/\{([^}]+)\}\s*=\s*'([^']*)'/g)];
    const fields = new Set(parts.map((p) => p[1]));
    if (parts.length && fields.size === 1) {
      const field = [...fields][0];
      const vals = parts.map((p) => sqlLit(p[2])).join(", ");
      return `where fields->>${sqlLit(field)} in (${vals})`;
    }
  }

  throw new Error(
    `${nodeName}: filterByFormula not recognised, refusing to guess:\n    ${f}`,
  );
}

const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * A column mapping becomes a JS object literal inside one expression, which
 * at_write then applies. Literal values are quoted; expression values are
 * inlined so they still evaluate in the node's own context.
 */
function buildColumnObject(value, nodeName) {
  const entries = [];
  for (const [k, v] of Object.entries(value)) {
    if (k === "id") continue;
    if (ATTACHMENT_FIELDS.includes(k)) {
      throw new Error(
        `${nodeName}: writes the attachment field "${k}". Airtable fetched those ` +
          `bytes itself; Postgres cannot. This node needs a download chain — ` +
          `see "The four nodes that need more than a query" in CLAUDE.md.`,
      );
    }
    const key = JSON.stringify(k);
    entries.push(`${key}: ${isExpr(v) ? exprBody(v).replace(/^\{\{|\}\}$/g, "").trim() : JSON.stringify(v)}`);
  }
  return `{{ JSON.stringify({ ${entries.join(", ")} }) }}`;
}

function buildUpdate(entity, params, nodeName) {
  const value = params.columns?.value ?? {};
  if (value.id === undefined) throw new Error(`${nodeName}: update with no id mapping`);
  return (
    `select * from hov.at_write(${dq(entity)}, ${dq(inlineExpr(value.id))},\n` +
    `  ${dq(buildColumnObject(value, nodeName))}::jsonb)`
  );
}

function buildCreate(entity, params, nodeName) {
  const value = params.columns?.value ?? {};
  return `select * from hov.at_create(${dq(entity)},\n  ${dq(buildColumnObject(value, nodeName))}::jsonb)`;
}

// ---------------------------------------------------------------------------

function convert(node) {
  const p = node.parameters ?? {};
  const tableId = p.table?.value ?? p.table;
  const entity = ENTITY_BY_TABLE[tableId];
  if (!entity) throw new Error(`${node.name}: unknown table ${tableId}`);

  const op = p.operation ?? "get"; // a missing operation is Airtable's "get"
  const query =
    op === "get"
      ? buildGet(entity, p)
      : op === "search"
        ? buildSearch(entity, p, node.name)
        : op === "update"
          ? buildUpdate(entity, p, node.name)
          : op === "create"
            ? buildCreate(entity, p, node.name)
            : (() => {
                throw new Error(`${node.name}: unsupported operation "${op}"`);
              })();

  // Everything except the Airtable-specific bits is carried over untouched:
  // onError, retryOnFail, alwaysOutputData, notes, disabled, executeOnce…
  // Those encode hard-won behaviour (several nodes are onError:continue on
  // purpose) and re-deriving them would be a second migration.
  const { parameters, type, typeVersion, credentials, ...rest } = node;
  return {
    ...rest,
    type: "n8n-nodes-base.postgres",
    typeVersion: 2.6,
    parameters: { operation: "executeQuery", query, options: {} },
    credentials: { postgres: PG_CRED },
  };
}

// ---------------------------------------------------------------------------

const [, , file, ...flags] = process.argv;
if (!file) {
  console.error("usage: port-airtable-nodes.mjs <workflow.json> [--write]");
  process.exit(1);
}
const write = flags.includes("--write");
const wf = JSON.parse(readFileSync(file, "utf8"));

const done = [];
const refused = [];
wf.nodes = wf.nodes.map((n) => {
  if (n.type !== AIRTABLE_TYPE) return n;
  try {
    const out = convert(n);
    done.push(n.name);
    return out;
  } catch (e) {
    refused.push(e.message);
    return n; // left exactly as it was
  }
});

console.log(`\n${wf.name}`);
console.log(`  converted ${done.length}:`);
for (const n of done) console.log(`    · ${n}`);
if (refused.length) {
  console.log(`  REFUSED ${refused.length}:`);
  for (const r of refused) console.log(`    · ${r}`);
}

if (write) {
  writeFileSync(file.replace(/\.json$/, ".ported.json"), JSON.stringify(wf, null, 2));
  console.log(`  → ${file.replace(/\.json$/, ".ported.json")}`);
}
