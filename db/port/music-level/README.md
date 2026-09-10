# Music volume — the port

Status: **LIVE since 2026-09-09 ~18:00 UTC** on the n8n side; the site and
render-server halves are on branch `claude/port-flow-images-media-scripting-hhzv5g`
and reach production only when that branch is merged into the trunk
(`claude/hello-7o90qh`). Until then Final Assembly sends `musicVolume` and the
old `assemble.mjs` ignores it (the bed stays at 0.22), which is the same sound
as before.

| Workflow | now active | was active (node body saved in `original/`) |
|---|---|---|
| 1. Master Orchestrator `8CienBFfG6SgbB1A` | `161ea5a8` | `a2bfdbec` |
| 4. Final Assembly `BY22Vlhh20Xdkr5Z` | `62a3b382` | `8009bd23` |

Applied with `update_workflow` (`applied/*.json`, verbatim), each draft fetched
back and diffed node-by-node against `activeVersionId` — exactly one changed
node in each, parameters byte-equal to the operation, edges and settings
untouched, Drive nodes intact — then `publish_workflow` with the draft's own
`versionId`. Rollback: `restore_workflow_version` to the "was active" id.

What it does, in the order a film meets it: the brief's Music row grows a
"Music volume" slider (5–100%, default 22 = the constant the mix graph always
used) → `Normalize Webhook Input` stores `Editing Options.musicLevel` →
Final touches shows the same slider, `confirmFinalSettings` merge-writes it →
`Build Timeline` sends `musicVolume` while music is on → `/assemble` uses it
as the music bed's `volume=` before the sidechain duck. The accents at the
cuts (boom / whoosh / riser) keep their fixed levels on purpose.

The library check done the same day (list, share, Railway proxy, a real
render with music on, the folder's Drive permissions) is written up in
CLAUDE.md under "The background track is choosable now".
