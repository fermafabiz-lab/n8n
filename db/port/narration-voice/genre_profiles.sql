-- Narration voice, 2026-09-13: the voice says what the picture cannot.
-- Rollback: original/genre_profiles.rollback.sql (the 2026-09-10 rows).
--
-- Two things here. (1) Four fiction profiles were written on 09-10 in
-- screenplay language ("The sentence is a SHOT", "hands, objects, weather",
-- "an object, a gesture, a distance") and the only film written under them
-- carried the highest picture-description density measured on any film.
-- Those sentences are replaced with the intent/stake/cost vocabulary; every
-- "image" in a structure becomes an event or a consequence, because an
-- image is the segmenter's job. (2) One SHARED clause is appended to every
-- profile's voice, idempotently, so no tone can drift back into describing
-- the frame. Idempotent: re-running changes nothing.
begin;

-- Cinematic: the sentence was a SHOT; now it is a decision.
update hov.genre_profile set
  voice = 'PRESENT tense, close on one character. The sentence is a DECISION — what the character wants, what they do about it, what it costs, what goes wrong. The picture carries the action and the place; the voice carries the reason and the stake. No inner monologue as explanation, no adjectives of emotion; emotion is inferred from what they choose. Cut hard between beats like an editor, not a narrator: no "meanwhile", no "as", no bridging, no signposting. Subtext: what a character wants is never said outright, only pursued. Never mention the camera, the film or the viewer.',
  structure = E'1) In medias res — the character mid-action, the want already visible in what they are doing.\n2) The break — the plan fails, in one concrete event with a cost attached.\n3) Escalation in steps, each raising the cost and closing one exit; every chapter one new obstacle, never the same problem twice.\n4) The choice: the character gives something up on purpose. A climax is a decision, not an accident.\n5) The last beat: what changed, stated once, unexplained.',
  updated_at = now()
where tone = 'Cinematic';

-- Dramatic: lines landed on "an object, a gesture, a distance" — the frame.
update hov.genre_profile set
  voice = 'PRESENT tense, close on one character, with a second who wants the opposite. Conflict lives in what people DO to each other, never in commentary. Lines land on the concrete — a choice, a cost, a refusal, the distance between two people — and stop; no sentence explains a feeling, names a theme or sums up. The narrator takes no side. No signposting ("Now", "Then", "Meanwhile"), no definitions, no mention of the film, the camera or the viewer.',
  structure = E'1) Two people who want incompatible things, shown in ONE shared scene through what they do, not what they say about it.\n2) The first choice that costs someone — a door closed, a letter unopened, a seat taken.\n3) Each chapter one confrontation that changes the balance: a secret out, an ally lost, a line crossed. Never the same argument twice.\n4) The point of no return: a choice that cannot be undone, made on purpose.\n5) Consequence, stated, without comment — the last beat is the new balance between them.',
  updated_at = now()
where tone = 'Dramatic';

-- Epic: "the person still in frame" is a camera note.
update hov.genre_profile set
  voice = 'PRESENT tense, wide scope through one person who cannot avoid what is coming. Sentences carry SCALE — men, miles, years, tonnes, degrees — set against one body and what it decides. No abstractions ("destiny", "glory", "history itself"), no speeches, no lessons; the narrator reports what happens and what it costs, never how to feel. No signposting, no definitions, no mention of the film or the viewer. Short sentences at the moments of greatest scale.',
  structure = E'1) The scale of what is coming, seen through ONE person at ground level, with the numbers that measure it.\n2) The decision that commits them, and the first cost, paid immediately.\n3) Escalation by numbers and distance — each chapter a larger force, a harder ground, a longer march; never the same obstacle twice.\n4) The ordeal as a sequence of concrete actions and their costs, one thing at a time, the person still at the centre of it.\n5) The aftermath at the same scale as the opening: what is left, counted.',
  updated_at = now()
where tone = 'Epic';

-- Emotional: "hands, objects, weather, what is left on a table" is the picture.
update hov.genre_profile set
  voice = 'PRESENT tense, close on one person. Restraint carries the feeling: understate at the exact moment the viewer expects you to swell. Sentences short and plain — what someone does, keeps doing, gives up, or fails to say. Nothing is named sad, brave or beautiful; no lesson, ever; no "you can feel"; no signposting; no mention of the film or the viewer. Every beat carries one particular the viewer could not have guessed — a habit, a number, a name, a thing left undone.',
  updated_at = now()
where tone = 'Emotional';

-- Dark and Horror keep sound, smell and temperature — the senses the picture
-- has no access to — and give up "texture", which it does.
update hov.genre_profile set
  voice = 'FIRST or close SECOND person, PRESENT tense. Short sentences; fragments allowed where they land a beat. Concrete sensory detail the picture cannot carry — sound, smell, temperature, what is felt through the hands — instead of descriptions of emotion; never what is visible, the picture owns that. Never name the fear directly and never tell the viewer to be afraid. Withhold: the sentence that explains everything is the sentence that kills the dread. Never define the rule of the world in a sentence — the viewer learns it by watching it break something. No signposting, no "now", no "then"; the cut does that.',
  updated_at = now()
where tone in ('Dark', 'Horror');

-- Educativ: "a material" is a texture word; "a picture" is the segmenter's job.
update hov.genre_profile set
  voice = 'Second or third person, PRESENT tense. Cool, exact and quietly amazed — the register of someone who knows the mechanism and still cannot quite believe it works. NEVER define a term in its own sentence ("A pile is…", "Reclamation means…"): the meaning arrives inside the action with a number attached ("crews drive 230 concrete piles forty metres down, into sand that no longer moves"). Every beat carries a particular — a number, a name, a time, a temperature, a price, a consequence. Difficulty is a specific risk with a concrete consequence, never an adjective ("extreme", "ambitious", "huge"). No rhetorical questions after the hook, no "imagine", no chummy asides, no "you can feel", no tidy recaps. Hard cuts between ideas: no bridging or steering sentences ("Now the work shifts", "So the question is").',
  structure = E'1) Open on the fact that should not be possible, stated as an event with a number in it — no question, no definition.\n2) The obstacle as physics, money or time: what exactly breaks if the obvious approach is used, with the figure that proves it.\n3) The mechanism, one step per beat, each step shown as a DECISION somebody made and what it cost — never a lecture, never a term defined in its own sentence.\n4) The counter-intuitive turn: the step that goes the opposite way from what the viewer expected, and the concrete reason it works.\n5) The consequence made plain: what exists now that could not before, ending on the sharpest single consequence — not a summary, not a moral.',
  hook_rule = 'An impossible-sounding fact with a number in it, stated as one concrete event — no question mark, no "what if I told you".',
  updated_at = now()
where tone = 'Educativ';

-- Motivational: the payoff was "one image the viewer can see".
update hov.genre_profile set
  structure = E'1) Open INSIDE a concrete moment where the protagonist is stuck — shown through what they do, never stated.\n2) The decision that sets everything in motion, and what it costs them immediately.\n3) Rising difficulty: each chapter brings ONE new, specific obstacle and one specific thing the protagonist does about it — never the same problem twice, never a return to an earlier moment.\n4) The turning point: the moment the method finally works, shown as one concrete event with a number in it.\n5) The payoff: what changed, in one concrete result with a number or a name in it — and the single lesson, said ONCE, in the last beat of the film.',
  updated_at = now()
where tone = 'Motivational';

-- The SHARED clause, appended once to every profile.
update hov.genre_profile set
  voice = voice || ' THE VOICE SAYS WHAT THE PICTURE CANNOT. The viewer already sees the place, the light, the weather, the surfaces and the movement: never spend a sentence on them, and never write a shot. A place or a time may be NAMED, never described. Each sentence carries something the image cannot show — the intent, the stake, the cost, the cause, the consequence, a number, a name, a date.',
  updated_at = now()
where voice not like '%THE VOICE SAYS WHAT THE PICTURE CANNOT%';

commit;
