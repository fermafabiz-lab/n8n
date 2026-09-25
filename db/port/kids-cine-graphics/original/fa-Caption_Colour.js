// The colour a spoken caption word is painted, chosen per film on the brief
// or in Final touches and stored as Editing Options.captionColor.
//
// Its OWN node rather than a line inside Build Remotion Props: that node is
// large and actively edited by several people, and this needs nothing from it
// but the body it already produced. Same reason Attach Motif Cards is its own
// node beside it.
//
// Absent means the white default, and that is a real decision rather than a
// missing one: white with the spoken word marked by BRIGHTNESS is the only
// accent that reads on every kind of footage — one that sits well on a night
// dock is wrong on snow. Every film used to come out amber because this prop
// defaulted to palette.primary and nothing ever set it.
//
// resolveCaptionAccent() in remotion/src/captionColor.ts has the final say and
// additionally lifts a too-dark accent toward white until it clears a
// luminance floor, because captions carry a heavy drop shadow and a deep
// colour disappears into its own shadow. The check here only keeps a
// malformed stored value from reaching the props at all.
const body = $json.body;

let opts = {};
try {
  opts = JSON.parse(($('Fetch Project Info').first().json.fields || {})['Editing Options'] || '{}') || {};
} catch (e) { opts = {}; }

const raw = String(opts.captionColor || '').trim();
if (raw && !/^(none|white|off)$/i.test(raw)) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    body.captionColor = '#' + h.toUpperCase();
  }
}

// The film's category and its animation style, for the motion packs
// (remotion/src/motion/packs.ts, 2026-09-24). Here rather than in Build
// Remotion Props for the reason this node exists at all: that node is large
// and edited by several people. `motionPack` goes through only when it is one
// of the four; absent lets the render apply the category's default
// (Editorial for Story). The engine port of Final Assembly
// (docs/plans/engine-final-assembly.md) must send the same two fields.
if (typeof opts.category === 'string' && opts.category.trim()) body.category = opts.category.trim();
if (['classic', 'editorial', 'punch', 'lowerThird'].includes(opts.motionPack)) body.motionPack = opts.motionPack;

// The film's graphic style and what it draws (remotion/src/graphics/,
// db/port/graphic-styles/, 2026-09-25). The producer's own pick wins; with
// none, the style the graphic-plan workflow chose by theme ("AI picks"). The
// items were written by that workflow against scene ORDER, because the
// render's scene list skips scenes that got no clip — mapped here the same way
// Attach Motif Cards maps its cards. Neither prop is sent when there is
// nothing to say: absent is classic, today's film.
const STYLES = ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten'];
const plan = (opts.graphicPlan && typeof opts.graphicPlan === 'object') ? opts.graphicPlan : null;
const style = STYLES.includes(opts.graphicStyle) ? opts.graphicStyle
  : (plan && STYLES.includes(plan.style) ? plan.style : null);
if (style && style !== 'classic') {
  body.graphicStyle = style;
  const planned = plan && Array.isArray(plan.items) ? plan.items : [];
  if (planned.length) {
    const orderById = new Map();
    try {
      for (const it of $('Fetch Approved Scenes').all()) {
        const f = it.json.fields || {};
        if (it.json.id != null) orderById.set(it.json.id, f['Ordine Scenă']);
      }
    } catch (e) {}
    const rendered = $('Prepare Clips').all().map((c) => orderById.get(c.json.id));
    const items = [];
    for (const it of planned) {
      const i = rendered.indexOf(it.sceneOrder);
      // A scene that got no clip is not in the film, so neither is its tag.
      if (!(i >= 0 && i < (body.scenes || []).length)) continue;
      const g = Object.assign({}, it);
      delete g.sceneOrder;
      g.sceneIndex = i;
      items.push(g);
    }
    if (items.length) body.graphicItems = items;
  }
}

// The film's transitions (remotion/src/transitions/, db/port/transitions/,
// 2026-09-25), for EVERY category — the producer's call: a transition belongs
// to a theme, not to a kind of film. The pick wins ('none' included); with
// none, the family the graphic-plan workflow chose. Absent is hard cuts.
const TRANSITIONS = ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'];
const transition = TRANSITIONS.includes(opts.transitionStyle) ? opts.transitionStyle
  : (plan && TRANSITIONS.includes(plan.transition) ? plan.transition : null);
if (transition && transition !== 'none') body.transitionStyle = transition;

return [{ json: { body } }];