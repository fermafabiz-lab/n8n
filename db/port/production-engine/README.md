# The orchestrator asks the site who produces a film (phase 6d)

`docs/plans/engine-media-generation.md`, phase 6. Before each of the three
`Execute Media Generation*` nodes of the Master Orchestrator (`8CienBFfG6SgbB1A`)
— Batch (after the script), Resume, Restart — an HTTP node posts
`{projectId, Voice_ID, Aspect_Ratio}` (the same values that node passes) to
`http://web:3000/api/ops/produce` with the `HOV Media Ingest` credential, and an
If routes on `$json.engine === 'code'`:

- `true`: the site queued `hov.production_job` and the engine produces the film.
  n8n stops there.
- `false`: n8n calls Media Generation exactly as before. This is also where an
  unset `PRODUCTION_ENGINE`, a 404 (site not deployed) and any error end up,
  because the HTTP node is `onError: continueRegularOutput`.

`orchestrator-ops.json` is the exact `update_workflow` operation list applied.
It was built on version `55ef60c7`, which is the rollback.
