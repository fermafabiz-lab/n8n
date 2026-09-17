# Site art — generating the site's own imagery on Flow

Status: **PREPARED, NOT YET RUN.** Blocked on one thing, below.

## What this is

The site's visuals come from the same Google Flow the films come from, rather
than from an external image service. Assets are generated **once and committed**
to `platform/public/art/`, so the site keeps zero runtime dependency on Flow:
no per-visitor cost, no latency, and nothing to break if useapi is down.

First asset: the entrance on `/login` — a photoreal modern studio building at
dusk, whose window bays are lit by real production counts.

## The mechanism

A throwaway workflow, archived after each run:

```
Manual Trigger
  → Site Art Submit   POST https://api.useapi.net/v1/google-flow/images
                      nano-banana-2, count: 1, captchaRetry: 1, aspectRatio 16:9
                      timeout 180000, n8n retries OFF
  → Site Art Collect  media[0].image.generatedImage.{fifeUrl, mediaGenerationId}
  → Site Art Fetch    GET the fifeUrl as a file — it is signed and dies in hours
  → Site Art Encode   base64 + byte count
```

then `execute_workflow`, read `runData`, verify the decoded length against the
reported byte count, write the file, `archive_workflow`.

The bytes ride back inside the execution because **a Claude Code web session has
no outbound HTTP at all** — `api.useapi.net` answers `000`, as do Poly Haven,
Sketchfab and every other asset host. Only GitHub and npm are reachable. The
n8n connector is the only way out.

`Site Art Collect` copies `IMG Error Router`'s routing with one deliberate
difference: **a throttle aborts rather than cooling down and retrying.** The
film pipeline grinds through a throttle because a film is at stake; site
decoration must yield to production rather than add load to the same account.
`402` is fatal. A content refusal stops and asks for a human rewording rather
than walking a rewrite ladder.

**Never run this while a film is in production** — same useapi account, and
Google throttles per account. Check `search_executions` first.

## What it is blocked on

The 14 nodes that call Flow today carry the token as a **literal header value**:

    Generate Scene Image, Regenerate Scene Image, Generate Cast Sheet,
    Generate Set Plate, Generate End Frame, RG Generate End Frame,
    IR Generate Image, IR Upload To Flow, Upload Asset To Flow,
    Upload Regen Asset To Flow, Submit Video, Submit Video Regen,
    Poll Video Job, Poll Video Regen

A new node therefore needs that value inlined, and a session should not be
handling the secret to build one.

**The fix is a credential, and it is an improvement rather than a workaround.**
n8n already holds `FAL` and `HOV Media Ingest` as `httpHeaderAuth` credentials,
and `Ingest Sheets` shows the wiring:

```
authentication : genericCredentialType
genericAuthType: httpHeaderAuth
credentials    : { httpHeaderAuth: { id: "…", name: "…" } }
```

So: create an **Header Auth** credential in n8n named `useapi Flow`, header name
`Authorization`, value the same `Bearer user:…` already in those nodes. Then
this workflow references it by id and the token never leaves n8n.

`CLAUDE.md` already lists "rotate the useapi key" as owed. Once the 14 nodes
move onto this credential, that rotation is one edit instead of fourteen.
