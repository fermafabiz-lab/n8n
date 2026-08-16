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
 * THE FOUR THAT ARE NOT QUERIES
 *
 * Four nodes write attachments — `"Imagine Scenă": [{url}]` — and relied on
 * Airtable going and fetching those bytes. That download is the one thing the
 * database cannot do, so those four become a single POST to
 * /api/media/ingest, which stores the file and applies the node's other fields
 * in the same transaction and answers with the scene in Airtable's own shape.
 * Dropping the attachment field instead would leave a scene looking generated
 * with nothing behind it, so an unrecognised attachment mapping still throws.
 */

import { readFileSync, writeFileSync } from "node:fs";

const AIRTABLE_TYPE = "n8n-nodes-base.airtable";

/**
 * The base URL of the Airtable-shaped shim on the site.
 *
 * Twenty-one nodes call api.airtable.com by hand — the Airtable node could not
 * do what they needed — and the first port, which filtered by node type, never
 * saw one of them. Rewriting their bodies was not an option: several are IIFEs
 * that parse a model's reply into a fields object. So only the host changes,
 * and the shim answers in Airtable's own dialect.
 */
const AIRTABLE_API = "https://api.airtable.com/v0/applPyJjvNzyxJkbv";
const SHIM_API = "http://web:3000/api/at";
const PG_CRED = { id: "eRjiNDQFuDSTJpGK", name: "HOV Postgres" };
const INGEST_CRED = { id: "8kpY42LmZaBYBzfY", name: "HOV Media Ingest" };

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
function buildColumnObject(value, nodeName, skip = []) {
  const entries = [];
  for (const [k, v] of Object.entries(value)) {
    if (k === "id" || skip.includes(k)) continue;
    if (ATTACHMENT_FIELDS.includes(k)) {
      throw new Error(`${nodeName}: unexpected attachment field "${k}"`);
    }
    const key = JSON.stringify(k);
    entries.push(`${key}: ${isExpr(v) ? exprBody(v).replace(/^\{\{|\}\}$/g, "").trim() : JSON.stringify(v)}`);
  }
  return `{ ${entries.join(", ")} }`;
}

/** The same object, wrapped for embedding in SQL. */
const columnObjectSql = (value, nodeName) =>
  `{{ JSON.stringify(${buildColumnObject(value, nodeName)}) }}`;

const FIELD_BY_ATTACHMENT = {
  "Imagine Scenă": "image",
  "Video Scenă": "video",
  "Versiuni Imagine": "image_version",
};

/**
 * The four nodes that write an attachment become a single HTTP call.
 *
 * Airtable accepted `[{url}]` and went and fetched the bytes itself. That
 * download is the one thing the database cannot do, so it moves to
 * /api/media/ingest, which stores the file and applies the node's other fields
 * in the SAME transaction — a scene must never end up holding a new image while
 * still claiming to await the old one.
 *
 * The endpoint answers with the scene in Airtable's own shape, so this is a
 * drop-in: `Wait Image Approval` and the rest read $json exactly as before.
 */
function buildIngest(params, nodeName) {
  const value = params.columns?.value ?? {};
  const attachKey = Object.keys(value).find((k) => k in FIELD_BY_ATTACHMENT);
  const field = FIELD_BY_ATTACHMENT[attachKey];

  // `[{ url: <expr> }]` / `[{ "url": <expr> }]` — pull the expression back out.
  const raw = String(value[attachKey] ?? "");
  const m = raw.match(/\[\s*\{\s*"?url"?\s*:\s*([\s\S]+?)\s*\}\s*\]/);
  if (!m) throw new Error(`${nodeName}: cannot read the url out of "${attachKey}": ${raw}`);
  const urlExpr = m[1].replace(/\}\}\s*$/, "").trim();

  const idExpr = exprBody(String(value.id)).replace(/^\{\{|\}\}$/g, "").trim();
  const rest = buildColumnObject(value, nodeName, [attachKey]);

  return {
    method: "POST",
    url: "http://web:3000/api/media/ingest",
    // A credential rather than {{ $env.MEDIA_INGEST_KEY }}: n8n can be
    // configured to block env access inside nodes, and whether it currently
    // does is not something the port should depend on. This is also how the
    // FAL header is already wired on this instance.
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      `={{ JSON.stringify({ sceneId: ${idExpr}, field: ${JSON.stringify(field)}, ` +
      `url: ${urlExpr}, fields: ${rest} }) }}`,
    options: { timeout: 180000 },
  };
}

function buildUpdate(entity, params, nodeName) {
  const value = params.columns?.value ?? {};
  if (value.id === undefined) throw new Error(`${nodeName}: update with no id mapping`);
  return (
    `select * from hov.at_write(${dq(entity)}, ${dq(inlineExpr(value.id))},\n` +
    `  ${dq(columnObjectSql(value, nodeName))}::jsonb)`
  );
}

function buildCreate(entity, params, nodeName) {
  const value = params.columns?.value ?? {};
  return `select * from hov.at_create(${dq(entity)},\n  ${dq(columnObjectSql(value, nodeName))}::jsonb)`;
}

// ---------------------------------------------------------------------------

function convert(node) {
  const p = node.parameters ?? {};
  const tableId = p.table?.value ?? p.table;
  const entity = ENTITY_BY_TABLE[tableId];
  if (!entity) throw new Error(`${node.name}: unknown table ${tableId}`);

  // Attachment writers take the other road entirely.
  const mapped = p.columns?.value ?? {};
  if (Object.keys(mapped).some((k) => ATTACHMENT_FIELDS.includes(k))) {
    const { parameters, type, typeVersion, credentials, ...rest } = node;
    return {
      ...rest,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      parameters: buildIngest(p, node.name),
      credentials: { httpHeaderAuth: INGEST_CRED },
    };
  }

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
const rerouted = [];
const refused = [];

/** An HTTP node that talks to Airtable: change the host, keep everything else. */
function reroute(n) {
  const p = { ...n.parameters };
  p.url = String(p.url).split(AIRTABLE_API).join(SHIM_API);
  // The Airtable PAT credential is replaced by the shim's shared header. The
  // node keeps its method, body, timeout and onError exactly as they were.
  if (p.authentication === "predefinedCredentialType") {
    p.authentication = "genericCredentialType";
    p.genericAuthType = "httpHeaderAuth";
    delete p.nodeCredentialType;
  }
  return {
    ...n,
    parameters: p,
    credentials: { ...(n.credentials ?? {}), httpHeaderAuth: INGEST_CRED },
  };
}

wf.nodes = wf.nodes.map((n) => {
  if (n.type === "n8n-nodes-base.httpRequest" && JSON.stringify(n).includes(AIRTABLE_API)) {
    rerouted.push(n.name);
    return reroute(n);
  }
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
console.log(`  converted ${done.length}, rerouted ${rerouted.length}:`);
for (const n of done) console.log(`    · ${n}`);
for (const n of rerouted) console.log(`    → ${n}  (http → shim)`);
if (refused.length) {
  console.log(`  REFUSED ${refused.length}:`);
  for (const r of refused) console.log(`    · ${r}`);
}

if (write) {
  writeFileSync(file.replace(/\.json$/, ".ported.json"), JSON.stringify(wf, null, 2));
  console.log(`  → ${file.replace(/\.json$/, ".ported.json")}`);
}
