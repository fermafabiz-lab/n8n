"""Measure the proposed end-frame decision rule against real stored prompts.

Corpus A: the 16 repaired prompts of the cafe film (after.json), written under
          the new rule 6 -- i.e. what the pipeline produces from now on.
Corpus B: the original 16 (from the pre-repair readback, embedded below as the
          shapes that mattered), to check the rule is not tuned only to the fix.
"""
import json, re

DIR = '/home/user/n8n/db/port/motion-permanence/cafe-film'
rows = json.load(open(DIR + '/after.json'))

ACTION = re.compile(r'\b(reach\w*|grab\w*|strip\w*|lift\w*|set\w*|place\w*|pivot\w*|turn\w*|'
                    r'open\w*|close\w*|pour\w*|wipe\w*|hand\w*|press\w*|twist\w*|carr\w*|'
                    r'straighten\w*|walk\w*|step\w*|lean\w*|hold\w*)\b', re.I)
CAMERA_MOVING = re.compile(r'\b(tracking|dolly|pan|crane|push-?in|push in|pull-?out|orbit|truck|'
                           r'handheld|slider|zoom|rack focus)\b', re.I)
CAMERA_STATIC = re.compile(r'\b(static locked-?off|locked-?off|static shot)\b', re.I)
RETURN_EXIT = re.compile(r'\b(back toward|turns? back|walks? away|exits?|off-?screen|out of frame)\b', re.I)
HELD = re.compile(r'\b(hands?|holds?|holding|carries|carrying|stack|tray|cup|portafilter|cloth)\b', re.I)
DIRECTION = re.compile(r'\b(left to right|right to left|toward the camera|away from the camera|'
                       r'out of|into|across)\b', re.I)

def verdict(text):
    t = text.split('Negative:')[0]
    hits = []
    n_act = len(set(m.group(0).lower() for m in ACTION.finditer(t)))
    if n_act >= 2: hits.append('actions=%d' % n_act)
    if CAMERA_MOVING.search(t) and not CAMERA_STATIC.search(t): hits.append('camera-moves')
    if RETURN_EXIT.search(t): hits.append('return/exit')
    if HELD.search(t): hits.append('held-object')
    has_dir = bool(DIRECTION.search(t))
    return hits, has_dir, n_act

print('%-5s %-7s %-5s %s' % ('scene', 'draw?', 'dir', 'why skipped'))
drawn = 0
per_rule = {}
for r in rows:
    hits, has_dir, n = verdict(r['motion'])
    draw = (not hits) and has_dir
    drawn += draw
    for h in hits:
        per_rule[h.split('=')[0]] = per_rule.get(h.split('=')[0], 0) + 1
    print('%-5s %-7s %-5s %s' % (r['scene_order'], 'DRAW' if draw else 'skip',
                                 'y' if has_dir else 'n', ', '.join(hits) or '-'))
print()
print('end frames drawn: %d / %d' % (drawn, len(rows)))
print('per-rule skip counts:', per_rule)
print()
print('--- each rule ALONE, as a skip test ---')
for name, fn in [
    ('actions>=2',   lambda t: len(set(m.group(0).lower() for m in ACTION.finditer(t))) >= 2),
    ('camera-moves', lambda t: bool(CAMERA_MOVING.search(t)) and not CAMERA_STATIC.search(t)),
    ('return/exit',  lambda t: bool(RETURN_EXIT.search(t))),
    ('held-object',  lambda t: bool(HELD.search(t))),
]:
    c = sum(1 for r in rows if fn(r['motion'].split('Negative:')[0]))
    print('  %-14s would skip %2d / %d' % (name, c, len(rows)))
