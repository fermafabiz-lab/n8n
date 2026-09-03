# A ceiling on a scene, and a tail that bounces instead of freezing

**APPLIED 2026-09-03.** One node in Claude Scripting (`gkEtGMecv4TC3ZHp`,
`Plan Scene Splits`, live version `b535dba7`), diffed against
`Plan Scene Splits.after.js` after publishing, with no other node touched. The
other half of the same fix is in the repo, not in n8n:
`remotion/server/assemble.mjs`.

`*.before.js` is the rollback: paste it back into the node and publish.

## What went wrong, in one number

The 71-scene Boyd film had a scene carrying **16.7 seconds of narration over an
8-second clip**. Elastic timing gives a scene the length of its own voice and
stretches the picture to fill it, clamped at 1.5×, so twelve of those seconds
were slow motion and the last five were a **frozen frame** — under a voice that
keeps talking. It reads as the film stopping.

## The cause was a rule with only one direction

`planChunks` folds runt chunks into a neighbour so an eight-second shot never
carries four words. Folding can only make a chunk BIGGER, and nothing checked
how big — the ceiling simply did not exist. On this chapter that produced a
34-word chunk where every other one was 12 to 28.

`MAX_WORDS_PER_SCENE` is 1.45 × the 22-word target, and anything over it is
split back down at a sentence boundary where there is one, then clause
punctuation, then a plain word gap. That "cut this near its middle" rule was
already written inline for the unit splitter; it is now `cutNear`, shared by
both, because a second copy of a rule is how the two come to disagree.

Verified on the real chapter, reconstructed from the film's own scenes:

```
OLD: 18 scenes, max 34 | 28 16 24 18 27 12 22 19 18 20 20 19 28 23 24 20 34 18
NEW: 19 scenes, max 28 | 28 16 24 18 27 12 22 19 18 20 20 19 28 23 24 20 14 20 18
```

Every other chunk is byte-identical, and the chunker is still lossless — the
chunks rejoin to exactly the input. Five edge cases (a 60-word run-on with no
punctuation, a single 50-word sentence, a 9-word chapter, empty, two long
sentences) come out unchanged from the previous node.

## And the repair at the other end

A ceiling on words cannot guarantee a ceiling on SECONDS: the same 22 words run
2.1 to 2.75 words a second depending on what is in them, and code that cannot
know the pace should not pretend to. So `assemble.mjs` no longer freezes what
the clip cannot cover — it plays the end of the clip BACKWARDS. Nothing jumps,
because the seam is the same frame twice, and on ambient footage a bounce reads
as motion rather than as a loop. Bounded at six seconds, because `reverse`
buffers every frame it is given (~200 MB at 1280x720) and this box has lost
renders to memory before.

Measured with `freezedetect` on the exact worst case (8s clip, 17.04s scene):
frozen time **5.08s → 0**, frame count unchanged at 409.
