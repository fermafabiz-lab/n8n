// Narration Guard hands over the edited narration already split into
// chapters; the outline supplies each chapter's plan (summary, ENDS WITH /
// LEADS INTO) for the segmenter. Matched by chapter_number, by position as a
// fallback. story_spine rides along for the hook.
const g = $json;
const outline = $('Generate Outline').first().json.output || {};
const planned = outline.chapters || [];
const chapters = (g.chapters || []).map((c, i) => {
  const o = planned.find(p => Number(p.chapter_number) === Number(c.chapter_number)) || planned[i] || {};
  return {
    chapter_number: c.chapter_number,
    chapter_title: c.chapter_title || o.chapter_title || '',
    chapter_summary: o.chapter_summary || '',
    narrator_script: String(c.narrator_script || '').trim(),
  };
});
if (!chapters.length) throw new Error('No chapters to combine.');
return [{ json: { output: { project_title: outline.project_title || 'Untitled', target_duration: outline.target_duration || '', story_spine: outline.story_spine || null, chapters } } }];
