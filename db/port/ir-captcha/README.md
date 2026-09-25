# IR Build Request: captchaRetry 1 → 5 (2026-09-25)

The site's image regeneration (`scene-image-regen`, Claude Scripting's `IR *`
tail) was the one Flow call left at `captchaRetry: 1` when every batch body
moved to 5 on 2026-09-23 (`db/port/captcha-retry/`); CLAUDE.md listed it as
owed. On 2026-09-25 it cost the producer three failed regenerations on the
Rome film in five minutes, each written on the scene as "REJECTED — edit the
image prompt" although the prompt was fine.

useapi's `captcha-stats` for 20:17–20:24 UTC: 41 attempts, **17% accepted**
by Google (CapSolver 38% of 13, 2Captcha 7% of 28); images 29% OK, 57%
403 `UNUSUAL_ACTIVITY`, 14% 429 `TOO_MUCH_TRAFFIC`. At one attempt a
regeneration fails most of the time; five pass about nine times in ten.

- `original/` — the live body of Claude Scripting `e1183aa3`.
- `paste/` — the same body with that one line (and its comment) changed.

The engine's image regeneration already sends 5 (`engine/src/image/request.ts`);
this fixes the n8n path, which is what the site uses until `IMAGE_ENGINE=code`.
