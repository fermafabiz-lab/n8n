-- ROLLBACK for genre_profiles.sql — the four writer-facing fields as they were
-- on 2026-09-10 before the rewrite (read off hov.genre_profile, execution 12011).
begin;
update hov.genre_profile set structure = $s$1) A character with a clear, concrete want, shown through action rather than statement.
2) The inciting break — something puts that want out of reach.
3) Rising cost: each chapter the character tries again and pays more.
4) The climax is a CHOICE, not an accident.
5) Close on what changed in the character, shown in a single concrete image.$s$, voice = $s$PRESENT tense, close on one character. Visual and physical — what they do with their hands, where they look, what they avoid. Emotion is inferred from behaviour, never announced. No narrator commentary explaining the meaning of events.$s$, hook_rule = $s$A character already in trouble, mid-action. No setup, no context.$s$, visual = $s$Anamorphic feel, shallow depth of field, motivated light, blocking that places the character in relation to the space.$s$ where lower(tone) = 'cinematic';
update hov.genre_profile set structure = $s$1) The official account, stated fairly and in full.
2) The first DOCUMENTED detail that does not fit it.
3) Each chapter adds one more verifiable discrepancy — never speculation stacked on speculation.
4) Separate explicitly what is documented from what is inferred.
5) Close on the strongest unanswered question, without asserting a conclusion the evidence does not support.$s$, voice = $s$Third person, PAST tense, scrupulously attributed. Never use loaded framing (“they don’t want you to know”, “the truth they hid”). Trust the discrepancies to do the work.$s$, hook_rule = $s$The single documented discrepancy that is hardest to explain.$s$, visual = $s$Observational and archival: available light, handheld or locked-off framing, restrained grade, documents and objects shown as evidence.$s$ where lower(tone) = 'conspiracy';
update hov.genre_profile set structure = $s$1) A problem the audience recognises as their own.
2) Why the usual answers fall short.
3) The approach, in plain terms.
4) Concrete proof — numbers, named cases, results.
5) One clear next step.$s$, voice = $s$First person plural or third person, PRESENT tense. Plain and confident, zero hype. Claims are specific and checkable. No superlative without a number behind it.$s$, hook_rule = $s$The problem stated in the audience’s own words.$s$, visual = $s$Clean, bright, shallow depth of field, real workplaces and real hands at work.$s$ where lower(tone) = 'corporate';
update hov.genre_profile set structure = $s$1) Normalcy, rendered in specific ordinary detail — the viewer must believe the place before it turns.
2) The first wrongness: small, deniable, easy to explain away.
3) Escalation — each chapter makes the previous explanation impossible.
4) The thing is seen, or almost seen. Show less than the viewer wants.
5) Aftermath, not resolution. Something remains.$s$, voice = $s$FIRST or close SECOND person, PRESENT tense. Short sentences; fragments allowed. Concrete sensory detail — sound, smell, temperature, texture — instead of descriptions of emotion. Never name the fear directly and never tell the viewer to be afraid. Withhold: the sentence that explains everything is the sentence that kills the dread.$s$, hook_rule = $s$A sensory wrongness, not a claim. One image or sound that is almost normal.$s$, visual = $s$Darkness used as composition rather than absence. Negative space, obscured figures, single practical light sources, frames held a beat too long.$s$ where lower(tone) in ('dark', 'horror');
update hov.genre_profile set structure = $s$1) Open on ONE concrete, verifiable anomaly — a specific object, number, date or moment that does not add up.
2) Establish the stakes plainly: who was affected and what was at risk.
3) Escalate through EVIDENCE, not adjectives — each chapter introduces a documented fact that reframes the previous one.
4) The turn: the point where the obvious reading of events breaks down.
5) Close on what is settled and what remains genuinely unknown. An open question is a legitimate ending; a manufactured resolution is not.$s$, voice = $s$Third person, PAST tense. Attribute contested claims (“according to the inquest”, “police recorded”). Specific nouns, real names, exact numbers and dates. Adjectives carry no emotional load — the facts do. No rhetorical questions to the viewer, no “imagine if”, no second person.$s$, hook_rule = $s$A single verifiable fact, stated plainly, that sounds impossible. No teasing, no “what if I told you”.$s$, visual = $s$Observational and archival: available light, handheld or locked-off framing, restrained grade, documents and objects shown as evidence.$s$ where lower(tone) = 'documentary';
update hov.genre_profile set structure = $s$1) A character with a clear, concrete want, shown through action rather than statement.
2) The inciting break — something puts that want out of reach.
3) Rising cost: each chapter the character tries again and pays more.
4) The climax is a CHOICE, not an accident.
5) Close on what changed in the character, shown in a single concrete image.$s$, voice = $s$PRESENT tense, close on one character. Visual and physical — what they do with their hands, where they look, what they avoid. Emotion is inferred from behaviour, never announced. No narrator commentary explaining the meaning of events.$s$, hook_rule = $s$A relationship already breaking, caught mid-sentence.$s$, visual = $s$Anamorphic feel, shallow depth of field, motivated light, blocking that places the character in relation to the space.$s$ where lower(tone) = 'dramatic';
update hov.genre_profile set structure = $s$1) A question the viewer can actually feel, not a definition.
2) The simplest true answer.
3) Why that answer is incomplete.
4) The mechanism, one step at a time, each step depending only on what came before.
5) What the viewer can now understand that they could not at the start.$s$, voice = $s$Second or third person, PRESENT tense. Define a term before using it. One new idea per beat. Analogies must be concrete and must not be stretched past their fit.$s$, hook_rule = $s$The everyday thing the viewer has never questioned, questioned.$s$, visual = $s$Observational and archival: available light, handheld or locked-off framing, restrained grade, documents and objects shown as evidence.$s$ where lower(tone) = 'educativ';
update hov.genre_profile set structure = $s$1) A character with a clear, concrete want, shown through action rather than statement.
2) The inciting break — something puts that want out of reach.
3) Rising cost: each chapter the character tries again and pays more.
4) The climax is a CHOICE, not an accident.
5) Close on what changed in the character, shown in a single concrete image.$s$, voice = $s$PRESENT tense, close on one character. Visual and physical — what they do with their hands, where they look, what they avoid. Emotion is inferred from behaviour, never announced. No narrator commentary explaining the meaning of events. Restraint carries the feeling: understate at the exact moment the viewer expects you to swell.$s$, hook_rule = $s$A small, specific, ordinary detail that will matter enormously later.$s$, visual = $s$Anamorphic feel, shallow depth of field, motivated light, blocking that places the character in relation to the space.$s$ where lower(tone) = 'emotional';
update hov.genre_profile set structure = $s$1) A character with a clear, concrete want, shown through action rather than statement.
2) The inciting break — something puts that want out of reach.
3) Rising cost: each chapter the character tries again and pays more.
4) The climax is a CHOICE, not an accident.
5) Close on what changed in the character, shown in a single concrete image.$s$, voice = $s$PRESENT tense, close on one character. Visual and physical — what they do with their hands, where they look, what they avoid. Emotion is inferred from behaviour, never announced. No narrator commentary explaining the meaning of events.$s$, hook_rule = $s$The scale of what is at stake, shown through one person who cannot avoid it.$s$, visual = $s$Wide vistas against small figures, strong backlight, deep staging, weather as a character.$s$ where lower(tone) = 'epic';
update hov.genre_profile set structure = $s$1) Open INSIDE a concrete moment where the protagonist is stuck — shown through what they do, never stated.
2) The decision that sets everything in motion, and what it costs them immediately.
3) Rising difficulty: each chapter brings ONE new, specific obstacle and one specific thing the protagonist does about it — never the same problem twice, never a return to an earlier moment.
4) The turning point: the moment the method finally works, shown as one concrete event.
5) The payoff: what changed, in one image the viewer can see — and the single lesson, said ONCE, in the last beat of the film.$s$, voice = $s$Third person, PRESENT tense, close on the protagonist — what they do, see and decide. Plain, direct sentences of 8-20 words. No lists, no "top five", no rhetorical questions. The viewer is addressed directly at most twice in the whole film: in the hook and in the final beat. Earn every imperative — at most one command in the whole film.$s$, hook_rule = $s$The viewer’s own excuse, said back to them accurately.$s$, visual = $s$Observational and archival: available light, handheld or locked-off framing, restrained grade, documents and objects shown as evidence.$s$ where lower(tone) = 'motivational';
commit;
