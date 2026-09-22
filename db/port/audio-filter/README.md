# A clip Google refuses for its AUDIO, diagnosed as a picture problem

Found 2026-09-22 on the producer's film **"The everyday life of an employee
working remotely in New York"** (`rec7U8PbMS8MUYQcW`), scene 7 on screen —
`scene_order` 106, `rec34uf9V2Castw3B`. The scene had been through the full
rewrite ladder and come to rest with this note:

> REJECTED by the video filter after 4 automatic prompt rewrites — Google
> video content filter. The START IMAGE is most likely what Google refuses:
> regenerate the image so no face or real person is in frame, approve it,
> then press Regenerate video.

**There is no face in that image.** It is an extreme close-up of a hand
reaching for a headset on a desk. The note sends the producer after
something that is not there.

## What Google actually says

Submitting the scene's own `startImage` with a deliberately blank prompt
("the camera holds completely still and nothing in the frame moves") gets a
400 whose body is unambiguous:

```
"mediaStatus": {
  "mediaGenerationStatus": "MEDIA_GENERATION_STATUS_FAILED",
  "error": { "code": 3, "message": "PUBLIC_ERROR_AUDIO_FILTERED" },
  "failureReasons": ["AUDIO_GENERATION_FILTERED"]
}
```

Veo 3.1 generates a soundtrack alongside the picture, and it is **the audio
that is refused**, not the frame and not the motion. The image is a hand
about to pick up a headset in front of a laptop — the model has every reason
to synthesise a voice on a call, and generated speech is what the filter
stops.

**So the four prompt rewrites could never have worked.** They rewrite the
MOTION prompt, which is not what is being refused.

## Why `VP Prep` gets it wrong

`Filter Failure?` routes on `PROMINENT || MINOR || FILTER || SAFETY` in the
response text. `AUDIO_GENERATION_FILTERED` contains `FILTER`, so it lands in
the motion-rewrite ladder. `VP Prep` then classifies:

```js
let reason = 'Google video content filter';
if (errText.includes('PROMINENT')) reason = '… a recognizable real person';
else if (errText.includes('MINOR')) reason = '… a child on screen';
```

There is no audio arm, so an audio refusal falls to the generic string, and
the give-up note blames the start image for a reason it does not have.

## Two things that are NOT available as fixes

- **`generateAudio: false` does not exist here.** useapi answers
  `400 {"error":"Parameter generateAudio not supported"}` — the same shape as
  `Parameter async not supported` on `/images`. The Veo audio track cannot be
  switched off through this API, so "just ask for a silent clip" is not an
  option.
- **Retrying is not a second roll of the dice.** Both submit paths derive the
  seed as `hash(sceneId + ':' + takes)`, where `takes` counts `kind: 'video'`
  entries in `media_versions` — and a clip that is REFUSED files no take. So
  `takes` stays 0, the seed stays identical, and **every rewrite and every
  press of "Regenerate video" re-rolls the exact same seed.** Four attempts
  were one attempt, four times. A scene that fails the filter before it ever
  produces a clip cannot escape by retrying.

  Whether a different seed clears an audio refusal is **not established** —
  one independent seed (33150, picked by Google when the probe sent none) was
  also refused, and a third attempt was cut short by the account guard, see
  below. Two distinct seeds refused is not proof of determinism.

## The probe cost something, and that is worth recording

Three submits in a few minutes on `fermafabiz@gmail.com` — while the
producer's own batch was submitting on the same account — produced first a
429 (`Try spacing your requests out`) and then a 403:

```
captcha_quality: PUBLIC_ERROR_UNUSUAL_ACTIVITY after 1 attempt
flow.google.com eb1hJf failed / PERMISSION_DENIED
```

`GET /v1/google-flow/accounts` read `health: OK` on all three afterwards, so
nothing was damaged. **Do not probe Flow by hand on an account a live batch
is using.** Use a quiet window, or the account the film is not on — and
remember an asset's account is fixed, so a foreign account answers
`Email mismatch` instead.

## What was done for the film

The remedy is the one the note recommends, for the right reason: give Veo a
still that gives it nothing to speak. Scene 106's stored prompts were
replaced with the two files in `paste/` — the same desk, the same light, the
same palette and lens language so it cuts with its neighbours, but a still
life with no person and no hand, and a motion prompt that only pushes in.
The originals, kept here so the change is reversible:

- `image_prompt` was: *"Extreme close-up of Maya Torres's left hand,
  olive-brown skin and thin black digital wristwatch visible beneath the
  rolled cuff of her light blue cotton button-front oxford shirt, reaching
  toward a black over-ear wireless headset … lying beside a 14-inch silver
  aluminum laptop …"*
- `motion_prompt` was: *"Slow push-in as a hand closes around a headset and
  lifts it slightly off the desk, keeping it in the hand through the end of
  the shot. The rest of the desk setup holds still in soft morning light,
  creating a serene atmosphere."*

Note the old motion prompt has **no `Negative:` tail**, unlike its
neighbours — it is the rewrite ladder's own output, and the ladder drops the
tail.

## What is owed

1. **Give `VP Prep` an audio arm.** `AUDIO_FILTERED` / `AUDIO_GENERATION_FILTERED`
   should be named as such, and the give-up note should say the audio track
   was refused and that the fix is a different start image — not "no face or
   real person in frame", which is advice for a different refusal.
2. **Vary the seed per attempt.** As long as `takes` is the only input, a
   refused scene is stuck on one seed for ever. Counting attempts (or mixing
   the attempt number into the hash on the rewrite path) is what makes four
   tries actually four tries. Measure it first on a scene that reproduces —
   scene 106's original image does.
3. **Audit the audio clause in `WORLD_RULES`.** Every submit ends
   `"Audio: quiet natural room tone plus the sounds the action itself makes.
   Negative: speech, voices, dialogue, singing, narration, music,
   soundtrack, …"` — and this repo's own expensive lesson is that naming a
   thing in a Veo prompt summons it. It is not the sole cause here (a probe
   with no audio clause at all was still refused on this image), but a
   negative list that names *speech, voices, dialogue, singing, narration*
   in every clip the pipeline makes deserves a measurement of its own.
