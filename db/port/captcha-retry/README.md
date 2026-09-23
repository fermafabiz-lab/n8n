# The refusals were captcha tokens, and we asked for one (2026-09-23)

Follow-up to `db/port/image-failover/`. With the failover live (Media
Generation `f7f03638`), the Rome film's resumed run (16497, 13:54) routed
around `houseofvideos01` exactly as designed — scenes 207 and 208 were made on
`fermafabiz` after `02` refused — and then **all three accounts** refused
within two minutes (`02` 13:56:10, `fermafabiz` 13:58:08, `01` 13:58:27). Every
account was avoided, so the old five-minute hold came back and the producer
reported the film stuck again at scene 21.

A refusal on every account at once is not three accounts flagged. useapi's
documentation for Flow says what it is:

> Request rejected by Google — the reCAPTCHA token was outright rejected (not
> just scored low). After internal retries with fresh tokens, the worker
> returns this. […] Increase `captchaRetry` […] to 5 or higher, and configure
> additional providers […] so `captchaOrder` can cycle across them.

and `captcha-stats` agrees: it files these 403s under
`success_rate_by_provider`, and CapSolver stood at **66.67%** over the film,
with `avg_attempt: 1`. The pipeline has sent `captchaRetry: 1` since
2026-09-02 (`db/port/flow-images/README.md`, "`captchaRetry: 1`"), on the
reasoning that on `UNUSUAL_ACTIVITY` the extra tries "are pure spend". The
spend is a captcha solve — fractions of a cent. The saving was a refusal for
every weak token, each one converted by our own guard into 60 s to 5 min of
waiting. The reasoning was wrong about what the error is.

`captchaRetry` is 1-10, default 5, and "cycles through configured providers in
priority order". Two are configured (CapSolver, 2Captcha), so 5 also brings
the second provider into play without setting `captchaOrder` (the three
captcha parameters are mutually exclusive).

## What changed — Media Generation `c8e6df0c` (rollback `f7f03638`)

`captchaRetry = 5` is set as the LAST step of the body expression in every
node that sends a Flow generation — overriding whatever the builder node wrote,
so the eight Code nodes that still write `captchaRetry: 1` (Build Image
Request, Evaluate Image Approval, Current Scene, Submit Video Regen's literal,
Cast Sheet Prep, Set Plate Prep, End Frame Prompt, RG End Frame Prompt) did
not have to be re-pasted:

`Generate Scene Image`, `Regenerate Scene Image`, `Submit Video`,
`Submit Video Regen`, `Generate End Frame`, `RG Generate End Frame`,
`Generate Cast Sheet`, `Generate Set Plate`.

Diff against `f7f03638`: changed 8, connections identical, settings identical,
bodies byte-equal to `paste/`.

The failover stays: a 403 that survives five fresh tokens is worth routing
around.

## Not changed

- **Claude Scripting `IR Build Request`** still sends `captchaRetry: 1` for
  the image-regen button and for the video ladder's still regeneration.
  Another session was publishing Deep Search changes to Claude Scripting at
  the same minutes (`8c317407`, `a9020286`, `538a914c`), and n8n has no
  merge; it is a regen path, not the batch, so it waits for a quiet window.
  The fix is the same one line at the end of `IR Generate Image`'s body.
- **`veo-3.1-lite-low-priority` on invited family accounts.** useapi's docs
  say that since 2026-09-23 Google offers it only to the family manager. All
  three accounts share one credit pool (22,015), so they are a family; the
  model list still shows `veo_3_1_i2v_lite_low_priority` on all three, so
  nothing is proven either way. If clips on `01`/`02` fail with
  `PUBLIC_ERROR_MODEL_ACCESS_DENIED`, that is this.

## Owed

- Pause and Resume the Rome film: 16497 runs `f7f03638`, without this.
- On the resumed run, `captcha-stats` should show `avg_attempt` above 1 and
  far fewer 403s; the image phase should run at ~40 s a scene.
