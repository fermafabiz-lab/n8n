# Tooling for editing live n8n nodes

Before this, there were three uncoordinated ways a node body got from this
repo into production, found by reading every `db/port/*/` folder rather than
assumed:

- **MCP, draft-then-publish** — `update_workflow`/`publish_workflow`, only
  from a Claude session, one node parameter at a time, with a manual
  python/jq diff redone from scratch on every edit. This is how
  `Narration Guard`, `Validate Motif Cards`, `Build Timeline` and most of
  this repo's recent node edits actually happened.
- **A PUT straight through the REST API, with guards** —
  `motif-cards/apply.mjs`: reads a saved `GET` snapshot, writes a
  ready-to-PUT body, applies it with three guards (nothing running, the
  live `versionId` still matches the snapshot, the applied file contains
  the expected nodes). Used exactly once, never generalized.
- **No script at all** — most of the other `db/port/*/` folders are just the
  node's source body plus a README with manual steps (e.g.
  `hook-regen-dollar/hr_apply.js` is the "HR Apply" node's own source, not
  an applier).

This directory turns the second pattern into something reusable, and
formalizes a convention the first pattern needs to stop being ad hoc.

## The constraint that shapes everything here

**A Claude Code web session reaches GitHub and nothing else.** Measured
2026-09-18: `api.github.com` answers 200; every other host
answers with no response, which is exactly
why CLAUDE.md says `scripts/check-n8n.mjs` "has to be run from a machine
that can reach `wf7.house-of-videos.com`". `motif-cards/apply.mjs`'s
`fetch()` calls could never have run from inside a session like this one —
it was always run by an operator, on a different machine.

So the tools here split cleanly by **who can run them**:

| Tool | Runs from | Needs |
|---|---|---|
| `diff-workflow.mjs` | a Claude Code session, or anywhere | two JSON files already on disk, nothing else |
| `local-pg.mjs` | a Claude Code session, or anywhere | `@electric-sql/pglite` + `pglite-socket` installed in a scratch dir (the npm registry answers from a session) |
| `make-apply.mjs` | a Claude Code session, or anywhere | a committed `db/NNN_*.sql` and a verify query; writes the throwaway workflow that applies it through the n8n connector, the file embedded byte for byte (first used for db/014) |
| `served-css.workflow.js` | a Claude Code session, through the n8n connector | nothing but a class name only the new build has. A throwaway that fetches `/login` from inside n8n (`http://web:3000`) and reports whether the stylesheet it links carries that class. It answers "is the new container the one answering?" without SSH (first used for deploy #185) |
| `n8n-api.mjs`, `apply-workflow.mjs` | an operator's machine, or a future network-enabled environment | `N8N_API_URL` + `N8N_API_KEY`, real network to the n8n host |

Never ask a Claude session to run `apply-workflow.mjs` or anything that
imports `n8n-api.mjs` directly — it will fail with no useful error (the
`fetch()` call itself never completes), and the fix is not to retry, it's
to hand the command to whoever has the key and a working connection.

## `diff-workflow.mjs` — verify an edit before or after it goes live

    node db/port/lib/diff-workflow.mjs <before.json> <after.json> [options]

`<before.json>` / `<after.json>` are full n8n workflow exports — the shape
`GET /workflows/{id}` or the MCP connector's `get_workflow_details` /
`get_workflow_version` returns: `{name, versionId, connections, nodes: […]}`.

This is the "diff the draft against the version you meant to build on, node
by node, and confirm the ONLY entry that differs is yours" step CLAUDE.md
describes doing by hand (python/jq, invented fresh every time), turned into
one command. It checks:

1. Which nodes were added / removed / changed (by `name`), and — for every
   changed node — a per-key diff of `parameters`, with multi-line string
   fields (a Code node's `jsCode`, a prompt's `systemMessage`) diffed as
   real text rather than as one JSON-escaped blob.
2. `connections` deep-equality, with the specific source nodes whose
   outgoing edges moved.
3. Every Google Drive node in `after` has both `resource` and `operation`
   set, flagging as a **regression** any Drive node that had both in
   `before` and lost either in `after` — the exact trap CLAUDE.md documents
   four separate times (the Airtable import, a parked UI draft, two
   `create_workflow_from_code` calls) where the editor or a builder
   silently strips these on a round-trip.
4. Every `$('Some Node')` reference in any node's `parameters`, checked
   against the node names that actually exist in `after` — a dangling
   reference is the "any node referenced by name must be reachable on
   every path that reaches it" trap (the restart-scripting tail, `Choose
   Bible`, `Settings Gate Guard`, `User Ref?`, …).

Pass `--expect "Node A,Node B"` to assert that **only** those node names
differ — anything else changing is treated as a failure. This is the
concrete form of the rule CLAUDE.md states after the speed-picker apply:
*"the ONLY entry that differs is yours"*.

No network, no dependencies, exits 1 on anything it considers a hard
failure (a dangling reference, an unexpected `connections` diff without
`--allow-connections`, an `--expect` violation, or a Drive regression).
Everything is printed either way — read the output, the exit code is a
convenience for scripting, not a substitute for it.

## `node-body.mjs` — read one node out of a snapshot

    node db/port/lib/node-body.mjs <snapshot.json> "<Node Name>" [parameter.path]
    node db/port/lib/node-body.mjs <snapshot.json> --list

Prints a node's `parameters`, or one parameter raw when given a path, so it
can be redirected to a file and then `node --check`ed, diffed, or fed to
`check-expression.mjs`. It accepts all three snapshot envelopes this repo
produces — `get_workflow_version` (`{nodes, connections}`),
`get_workflow_details` (`{workflow: {...}}`) and a plain REST `GET` — because
three tools write them and they disagree.

**It exists because of the oversized-result trick.** `get_workflow_details`
on a 500 KB workflow overflows the tool result and the harness spills it to a
file, naming the path in the error. That is not a failure to work around: it
is the cheapest way to get a whole live workflow into a session without
putting any of it in context. Save the file, point these tools at it, and the
500 KB never costs a token.

    node db/port/lib/node-body.mjs "Media Generation.draft.json" "Current Scene" jsCode > /tmp/live.js
    node --check /tmp/live.js
    diff /tmp/live.js paste/"Current Scene".js

## `check-expression.mjs` — syntax-check an `={{ ... }}` parameter

    node db/port/lib/check-expression.mjs <file> [--messages]

An httpRequest node's `jsonBody` here is nearly always one n8n expression
wrapping a JavaScript object literal — `={{ { model: '...', messages: [{role:
'system', content: '...'}] } }}`. Editing the prompt inside it means editing a
string literal nested in an object literal, by hand, through a tool call.
`node --check` cannot help, because the file is not a program. One unescaped
apostrophe and the node throws at runtime, on a producer's click, hours later.

This evaluates the expression with `$()`, `$json` and friends stubbed to an
opaque proxy, then reports the shape: top-level keys, model, message count and
each message's role and length. It exits 1 on a syntax error, on
non-serialisable output, or on `messages` that is not an array.

**Use it differentially.** Run it on the live body and on your edit, then
compare the two reports: a prompt that grew is expected, a key that vanished
is the bug.

    node db/port/lib/node-body.mjs snap.json "VP Rewrite AI" jsonBody > /tmp/live.txt
    node db/port/lib/check-expression.mjs /tmp/live.txt
    node db/port/lib/check-expression.mjs paste/"VP Rewrite AI".txt

It checks syntax and shape, nothing else: every `$('Node')` chain evaluates to
a stub on purpose, so it will not tell you a node name is wrong — that is
`diff-workflow.mjs`'s dangling-reference scan.

## The mandatory canonical-source-file convention

**Any Code-node body or prompt edited through the MCP connector must come
from a real, committed file — never composed directly inside the tool
call.** Concretely: before calling `update_workflow` to change a node's
`jsCode` or `systemMessage`, that exact text must already exist at

    db/port/<feature>/paste/<Node Name>.js      (or .md for a prompt)

This is not new — `motif-cards/paste/` and `story-ending/paste/` already do
this — but it was never a rule anyone had to follow, and it is the only
thing that makes `diff-workflow.mjs` useful: "diff before, diff after"
only works as a script if there is a real `before` file and a real `after`
file, rather than a tool-call argument nobody kept. It also means the
review is the file, in a normal diff/PR, not a node parameter nobody can
read back (the API redacts credentials but returns `parameters` fine — the
problem was never that it's unreadable, it's that nothing forced it to
exist anywhere durable before the edit went live).

## `n8n-api.mjs` / `apply-workflow.mjs` — apply from a machine with real network

    N8N_API_URL=https://wf7.house-of-videos.com N8N_API_KEY=<key> \
      node db/port/lib/apply-workflow.mjs --manifest db/port/<feature>/manifest.json
    …same, plus --rollback

`n8n-api.mjs` extracts the `fetch()` wrapper and the first two guards out of
`motif-cards/apply.mjs`. `apply-workflow.mjs` generalizes its hardcoded
`TARGETS` array into a manifest file:

```json
{
  "targets": [
    {
      "id": "<workflow id>",
      "name": "<workflow name, for logging>",
      "original": "<file>.original.json",
      "ported": "<file>.ported.json",
      "expect": ["Node A", "Node B"]
    }
  ]
}
```

Four guards, in the order each one bites:

1. Nothing running/waiting/new anywhere on the instance — a render or a
   scripting run mid-PUT is the one thing this must not risk.
2. The live `versionId` still matches the saved `.original.json` snapshot —
   otherwise this PUT would silently revert whatever someone else changed
   in between.
3. `.ported.json` actually contains every node named in `expect`.
4. **New.** After the PUT, re-fetch and confirm each `expect` node's
   `parameters` in the *live* workflow are byte-identical to what
   `.ported.json` sent. `motif-cards/apply.mjs`'s original three guards only
   ever checked that the node **names** came back — never that n8n stored
   what was actually sent. A PUT can answer 200 and still have silently
   normalized or dropped part of a parameter payload; guard 4 is what would
   have caught that.

`motif-cards/apply.mjs` is now a thin wrapper over these two files plus its
own `manifest.json` — the reference implementation. It is **not** a
retrofit: the other 16 `db/port/*/` folders that have no script keep not
having one until the work in them is touched again. New work adopts this
pattern; old work is not rewritten just to match it.

## `local-pg.mjs` — the site on a real Postgres, from a web session

    mkdir -p /tmp/pg && cd /tmp/pg && npm init -y >/dev/null \
      && npm i @electric-sql/pglite @electric-sql/pglite-socket
    LOCAL_PG_DEPS=/tmp/pg node db/port/lib/local-pg.mjs          # from the repo root
    cd platform && DATA_BACKEND=postgres \
      DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npx next dev -p 3211

The session cannot reach the `hov` database and demo mode has none, so a site
feature that WRITES Postgres used to be checkable only by reading its SQL.
This runs PGlite (Postgres compiled to WebAssembly) with every `db/NNN_*.sql`
applied in file order — the real migrations, not a copy — seeds 22 projects
across every status bucket and more than one page, and serves the wire
protocol, so the site's unmodified `pg` Pool connects and `psql` (installed)
can read what the page wrote. In memory: stopping it forgets everything, and
nothing in it can reach the box. First used for the playlists
(`db/port/playlists/`), whose browser scripts show the pattern for driving the
page in Chromium against it.

Two traps met while building it: `pkill -f <pattern>` from a Bash tool call
kills the tool's own shell when the pattern is in its command line — kill by
pid; and `next build` shares `.next/` with a running `next dev` — stop the dev
server first.
