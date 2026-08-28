// Restore the stream. Save scenes To Airtable1 emits one item per scene and
// Wait For Scene Approval is wired to receive exactly that; the motif chain
// collapses to a single item on its way through, so it has to hand the scenes
// back or the approval loop is fed something it never expected. Same move
// Evidence Done makes for the same reason.
return $('Save scenes To Airtable1').all();