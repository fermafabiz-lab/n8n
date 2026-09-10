-- Genre profiles, rewritten 2026-09-10 so that no tone reads as a friendly
-- explainer. Originals: original/genre_profile.json (and the rollback SQL at
-- the bottom of README.md). Apply through /db → Query, or a throwaway n8n
-- Postgres node. `wpm`, `research*`, `invention`, `montage_intensity` are
-- untouched — only the four fields the WRITER reads change.
begin;

update hov.genre_profile set
  structure = $s$1) Open on the fact that should not be possible, stated as a picture with a number in it — no question, no definition.
2) The obstacle as physics, money or time: what exactly breaks if the obvious approach is used, with the figure that proves it.
3) The mechanism, one step per beat, each step shown as a DECISION somebody made and what it cost — never a lecture, never a term defined in its own sentence.
4) The counter-intuitive turn: the step that goes the opposite way from what the viewer expected, and the concrete reason it works.
5) The consequence made visible: what exists now that could not before, ending on the sharpest single image — not a summary, not a moral.$s$,
  voice = $s$Second or third person, PRESENT tense. Cool, exact and quietly amazed — the register of someone who knows the mechanism and still cannot quite believe it works. NEVER define a term in its own sentence ("A pile is…", "Reclamation means…"): the meaning arrives inside the action with a number attached ("crews drive 230 concrete piles forty metres down, into sand that no longer moves"). Every beat carries a particular — a number, a material, a name, a time, a temperature, a price. Difficulty is a specific risk with a concrete consequence, never an adjective ("extreme", "ambitious", "huge"). No rhetorical questions after the hook, no "imagine", no chummy asides, no "you can feel", no tidy recaps. Hard cuts between ideas: no bridging or steering sentences ("Now the work shifts", "So the question is").$s$,
  hook_rule = $s$An impossible-sounding fact with a number in it, stated as an image the viewer can see — no question mark, no "what if I told you".$s$,
  visual = $s$Precise and material: machinery, hands, surfaces and scale references (a person against the structure), cutaways and cross-sections shown as pictures of real objects, light that reveals how things are made. Every frame names a specific thing; nothing generic. The hour and the weather change across chapters — noon glare, overcast, dusk with work lights, night under floodlights, dawn.$s$
where lower(tone) = 'educativ';

update hov.genre_profile set
  structure = $s$1) Open on ONE concrete, verifiable anomaly — a specific object, number, date or moment that does not add up.
2) Establish the stakes plainly: who was affected and what was at risk, in figures where the record has them.
3) Escalate through EVIDENCE, not adjectives — each chapter introduces a documented fact that overturns the previous chapter's obvious reading.
4) The turn: the point where that reading breaks down, shown through the document, the witness or the number that broke it.
5) Close on what is settled and what remains genuinely unknown. An open question is a legitimate ending; a manufactured resolution is not.$s$,
  voice = $s$Third person, PAST tense. Attribute contested claims ("according to the inquest", "police recorded"). Specific nouns, real names, exact numbers and dates. Adjectives carry no emotional load — the facts do. No rhetorical questions to the viewer, no "imagine if", no second person. Every beat carries a particular; no bridging or summarising sentences, and a chapter never opens on a transition ("Now", "At this point", "Meanwhile") — it opens on an event, a date or a document. Never define a term, never mention the film, the camera or a chapter: the viewer is inside the record, not being shown around it.$s$,
  hook_rule = $s$A single verifiable fact, stated plainly, that sounds impossible. No teasing, no "what if I told you".$s$,
  visual = $s$Observational and archival: available light, locked-off or handheld, restrained grade, period-correct texture; documents, objects and places shown as evidence. Consecutive chapters never share the same hour or weather — daylight exteriors, lamplit interiors, overcast, night — so the film reads as many days, not one.$s$
where lower(tone) = 'documentary';

update hov.genre_profile set
  structure = $s$1) The official account, stated fairly and in full, with its own dates and figures.
2) The first DOCUMENTED detail that does not fit it — one object, one time, one number.
3) Each chapter adds ONE more verifiable discrepancy and shows where it comes from — never speculation stacked on speculation.
4) Separate explicitly what is documented from what is inferred, at the moment the two part company.
5) Close on the strongest unanswered question, without asserting a conclusion the evidence does not support.$s$,
  voice = $s$Third person, PAST tense, scrupulously attributed. Never use loaded framing ("they don't want you to know", "the truth they hid"). Trust the discrepancies to do the work: a beat states a document, a date, a distance, a name, and stops. No bridging sentences, no signposting ("So", "Now", "Then came"), no definitions, no mention of the film or the viewer. The tension is in what the record does not say, stated exactly.$s$,
  hook_rule = $s$The single documented discrepancy that is hardest to explain, with its date.$s$,
  visual = $s$Archival and forensic: documents under a desk lamp, photographs pinned and re-read, night exteriors, surveillance-like framing, negative space, restrained grade. The light changes between chapters — daylight archive, lamplit night, overcast street — never the same twice in a row.$s$
where lower(tone) = 'conspiracy';

update hov.genre_profile set
  structure = $s$1) A problem the audience recognises as their own, stated in one concrete situation with a number in it.
2) Why the usual answers fall short — shown as what they actually cost someone, not asserted.
3) The approach, in plain terms, as a sequence of things people DO.
4) Concrete proof — numbers, named cases, measured results.
5) One clear next step.$s$,
  voice = $s$First person plural or third person, PRESENT tense. Plain and confident, zero hype. Every claim carries a number or a name; no superlative without a figure behind it. No mission-statement abstractions ("innovation", "excellence", "passion"), no definitions, no steering connectors, no chummy asides. Short sentences that land on a particular and stop.$s$,
  hook_rule = $s$The problem stated in the audience's own words, with the figure that makes it real.$s$,
  visual = $s$Clean, bright, shallow depth of field, real workplaces and real hands at work; product and process shown as objects, never as mood. The hour changes across chapters — morning start, afternoon floor, evening handover.$s$
where lower(tone) = 'corporate';

update hov.genre_profile set
  structure = $s$1) Normalcy, rendered in specific ordinary detail — the viewer must believe the place before it turns.
2) The first wrongness: small, deniable, easy to explain away.
3) Escalation — each chapter makes the previous explanation impossible, through one concrete thing that happens.
4) The thing is seen, or almost seen. Show less than the viewer wants.
5) Aftermath, not resolution. Something remains, named by one object.$s$,
  voice = $s$FIRST or close SECOND person, PRESENT tense. Short sentences; fragments allowed where they land a beat. Concrete sensory detail — sound, smell, temperature, texture — instead of descriptions of emotion. Never name the fear directly and never tell the viewer to be afraid. Withhold: the sentence that explains everything is the sentence that kills the dread. Never define the rule of the world in a sentence — the viewer learns it by watching it break something. No signposting, no "now", no "then"; the cut does that.$s$,
  hook_rule = $s$A sensory wrongness, not a claim. One image or sound that is almost normal.$s$,
  visual = $s$Darkness used as composition rather than absence. Negative space, obscured figures, single practical light sources, frames held a beat too long. Dusk, night, the grey before dawn and one flat overcast day — never bright, never the same light two chapters running.$s$
where lower(tone) = 'dark';

update hov.genre_profile set
  structure = $s$1) Normalcy, rendered in specific ordinary detail — the viewer must believe the place before it turns.
2) The first wrongness: small, deniable, easy to explain away.
3) Escalation — each chapter makes the previous explanation impossible, through one concrete thing that happens.
4) The thing is seen, or almost seen. Show less than the viewer wants.
5) Aftermath, not resolution. Something remains, named by one object.$s$,
  voice = $s$FIRST or close SECOND person, PRESENT tense. Short sentences; fragments allowed where they land a beat. Concrete sensory detail — sound, smell, temperature, texture — instead of descriptions of emotion. Never name the fear directly and never tell the viewer to be afraid. Withhold: the sentence that explains everything is the sentence that kills the dread. Never define the rule of the world in a sentence — the viewer learns it by watching it break something. No signposting, no "now", no "then"; the cut does that.$s$,
  hook_rule = $s$A sensory wrongness, not a claim. One image or sound that is almost normal.$s$,
  visual = $s$Darkness used as composition rather than absence. Negative space, obscured figures, single practical light sources, frames held a beat too long. Dusk, night, the grey before dawn and one flat overcast day — never bright, never the same light two chapters running.$s$
where lower(tone) = 'horror';

update hov.genre_profile set
  structure = $s$1) In medias res — the character mid-action, the want already visible in what they are doing.
2) The break — the plan fails in one concrete image.
3) Escalation in steps, each raising the cost and closing one exit; every chapter one new obstacle, never the same problem twice.
4) The choice: the character gives something up on purpose. A climax is a decision, not an accident.
5) The last image, held: what changed, shown once, unexplained.$s$,
  voice = $s$PRESENT tense, close on one character. The sentence is a SHOT — what is in frame, what moves, what the character does with their hands, where they look, what they avoid. No inner monologue, no explanation, no adjectives of emotion; emotion is inferred from behaviour. Cut hard between beats like an editor, not a narrator: no "meanwhile", no "as", no bridging, no signposting. Subtext: what a character wants is never said, only pursued. Never mention the camera, the film or the viewer.$s$,
  hook_rule = $s$A character already in trouble, mid-action. No setup, no context.$s$,
  visual = $s$Anamorphic feel, shallow depth of field, motivated practical light, deep blacks, blocking that places the character in relation to the space. The hour changes between chapters — dusk, night, blue hour, harsh noon — and weather is part of the story.$s$
where lower(tone) = 'cinematic';

update hov.genre_profile set
  structure = $s$1) Two people who want incompatible things, shown in ONE shared scene through what they do, not what they say about it.
2) The first choice that costs someone — a door closed, a letter unopened, a seat taken.
3) Each chapter one confrontation that changes the balance: a secret out, an ally lost, a line crossed. Never the same argument twice.
4) The point of no return: a choice that cannot be undone, made on purpose.
5) Consequence, shown, without comment — the last image is the new balance between them.$s$,
  voice = $s$PRESENT tense, close on one character, with a second who wants the opposite. Conflict lives in what people DO to each other, never in commentary. Lines land on the concrete — an object, a gesture, a distance — and stop; no sentence explains a feeling, names a theme or sums up. The narrator takes no side. No signposting ("Now", "Then", "Meanwhile"), no definitions, no mention of the film, the camera or the viewer.$s$,
  hook_rule = $s$A relationship already breaking, caught mid-sentence.$s$,
  visual = $s$Interiors with motivated light, faces in half-shadow, two-shots that measure the distance between people, handheld for confrontation, locked-off for aftermath. The hour and the weather move between chapters — a morning kitchen, a rainy afternoon window, a night corridor.$s$
where lower(tone) = 'dramatic';

update hov.genre_profile set
  structure = $s$1) An ordinary detail, specific and small, that the film will return to exactly once — at the end.
2) The loss or the distance, shown through routine: what someone keeps doing that no longer makes sense.
3) Attempts that fail, each smaller and more concrete than the last.
4) The moment of contact — one gesture, no speech, no explanation.
5) The detail from the opening, now meaning something else. End on it without saying what it means.$s$,
  voice = $s$PRESENT tense, close on one person. Restraint carries the feeling: understate at the exact moment the viewer expects you to swell. Sentences short and physical — hands, objects, weather, what is left on a table. Nothing is named sad, brave or beautiful; no lesson, ever; no "you can feel"; no signposting; no mention of the film or the viewer. Every beat carries one particular the viewer could not have guessed.$s$,
  hook_rule = $s$A small, specific, ordinary detail that will matter enormously later.$s$,
  visual = $s$Natural light, long lenses, shallow focus on hands and objects, quiet frames held a beat too long, muted palette with one warm colour. Morning and late-afternoon light dominant, with one overcast chapter and one at night — never the same light two chapters running.$s$
where lower(tone) = 'emotional';

update hov.genre_profile set
  structure = $s$1) The scale of what is coming, seen through ONE person at ground level, with the numbers that measure it.
2) The decision that commits them, and the first cost, paid immediately.
3) Escalation by numbers and distance — each chapter a larger force, a harder ground, a longer march; never the same obstacle twice.
4) The ordeal as a sequence of concrete actions, one thing moving at a time, the person still in frame.
5) The aftermath at the same scale as the opening: what is left, counted.$s$,
  voice = $s$PRESENT tense, wide scope through one person who cannot avoid what is coming. Sentences carry SCALE — men, miles, years, tonnes, degrees — set against one body. No abstractions ("destiny", "glory", "history itself"), no speeches, no lessons; the narrator reports what happens and never how to feel. No signposting, no definitions, no mention of the film or the viewer. Short sentences at the moments of greatest scale.$s$,
  hook_rule = $s$The scale of what is at stake, shown through one person who cannot avoid it, with one number.$s$,
  visual = $s$Wide vistas against small figures, strong backlight, deep staging, weather as a character. The light and the weather change between chapters — dawn marches, noon dust, storm, night camps under fire.$s$
where lower(tone) = 'epic';

update hov.genre_profile set
  structure = $s$1) Open INSIDE a concrete moment where the protagonist is stuck — shown through what they do, never stated.
2) The decision that sets everything in motion, and what it costs them immediately.
3) Rising difficulty: each chapter brings ONE new, specific obstacle and one specific thing the protagonist does about it — never the same problem twice, never a return to an earlier moment.
4) The turning point: the moment the method finally works, shown as one concrete event with a number in it.
5) The payoff: what changed, in one image the viewer can see — and the single lesson, said ONCE, in the last beat of the film.$s$,
  voice = $s$Third person, PRESENT tense, close on the protagonist — what they do, see and decide. Plain, direct sentences of 8-20 words that each carry a particular: a sum, a date, a place, an object. No lists, no "top five", no rhetorical questions, no definitions, no "you can feel", no signposting ("Now", "So", "Then"). The viewer is addressed directly at most twice in the whole film: in the hook and in the final beat. Earn every imperative — at most one command in the whole film. Never mention the film, the camera, a chapter or a turning point.$s$,
  hook_rule = $s$The viewer's own excuse, said back to them accurately.$s$,
  visual = $s$Observational and archival: available light, handheld or locked-off framing, restrained grade, documents and objects shown as evidence, the protagonist's hands at work. The hour moves with the story — early mornings, late nights under one lamp, a bright day only when something is finally won.$s$
where lower(tone) = 'motivational';

commit;
