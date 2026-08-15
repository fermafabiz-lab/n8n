-- Let a saved draft point at the file the scene is still holding.
--
-- `attachment.path` was unique across the whole table, which was right when
-- the only thing writing it was the import: one row per file, no reason for
-- two.
--
-- Saved drafts break that assumption, and not by accident. Pressing "Save
-- draft" files the image the scene is looking at RIGHT NOW — the bytes are
-- already in the media store as that scene's `image` row, so the draft is a
-- second row over the same file. Airtable solved this by re-uploading and
-- keeping two copies; here the file is ours already and copying it would buy
-- nothing but disk.
--
-- The invariant that actually holds is one row per (scene, field, path):
-- a scene may hold a file as its live image AND as a draft, but never twice
-- as the same kind.
--
-- `attachment_one_per_field_idx` is untouched — still exactly one live image
-- and one live clip per scene.

set search_path to hov, public;

alter table attachment drop constraint attachment_path_key;

create unique index attachment_scene_field_path_idx
  on attachment (scene_id, field, path);

comment on index attachment_scene_field_path_idx is
  'A file may appear once as the scene''s live asset and once as a draft of '
  'it, but not twice as the same kind. Replaced a global unique on path, '
  'which forbade a draft of the asset a scene currently holds.';

-- The join buildVersions() performs: an image draft's metadata names a
-- filename, and the row backing it has to be findable by that name.
create index attachment_scene_filename_idx
  on attachment (scene_id, filename)
  where field = 'image_version';
