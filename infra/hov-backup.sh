#!/bin/sh
# Nightly backup of everything that cannot be rebuilt from git.
#
# Three things matter here and only three:
#   hov       the pipeline's state. 14 MB — the whole point of the migration.
#   n8n       workflows AND credentials. Credentials are encrypted per-instance
#             and cannot be exported any other way, so losing this database
#             means re-entering every API key by hand.
#   media/    735 MB of images and clips that exist NOWHERE else. fal and Flow's
#             links died months ago; these files are the only copies left.
#
# Execution history is deliberately excluded from the n8n dump: it is 880 of
# that database's 894 MB, it prunes itself after 14 days anyway, and nobody has
# ever needed a three-week-old execution back.
#
# This protects against mistakes, not against the disk dying — everything it
# writes is on the same disk. Off-box is Hetzner's own backup, enabled in the
# console. Both, or neither is worth much.
set -eu

DIR=/opt/n8n/backups
KEEP=14
STAMP=$(date +%F)
cd /opt/n8n

mkdir -p "$DIR"

docker compose exec -T postgres pg_dump -U hov -d hov \
  | gzip > "$DIR/hov-$STAMP.sql.gz.tmp"
mv "$DIR/hov-$STAMP.sql.gz.tmp" "$DIR/hov-$STAMP.sql.gz"

docker compose exec -T postgres pg_dump -U n8n -d n8n \
  --exclude-table-data=execution_entity \
  --exclude-table-data=execution_data \
  --exclude-table-data=execution_metadata \
  | gzip > "$DIR/n8n-$STAMP.sql.gz.tmp"
mv "$DIR/n8n-$STAMP.sql.gz.tmp" "$DIR/n8n-$STAMP.sql.gz"

# The media tree is content-addressed and append-only, so a hard-linked mirror
# costs one copy on disk no matter how many days are kept: unchanged files are
# shared, only new ones take space.
rsync -a --delete --link-dest="$DIR/media-latest" media/ "$DIR/media-$STAMP/"
rm -rf "$DIR/media-latest"
ln -s "media-$STAMP" "$DIR/media-latest"

# Rotate.
ls -1d "$DIR"/hov-*.sql.gz 2>/dev/null   | sort | head -n -$KEEP | xargs -r rm -f
ls -1d "$DIR"/n8n-*.sql.gz 2>/dev/null   | sort | head -n -$KEEP | xargs -r rm -f
ls -1d "$DIR"/media-2* 2>/dev/null       | sort | head -n -3     | xargs -r rm -rf

echo "$(date -Is) ok  hov=$(du -h "$DIR/hov-$STAMP.sql.gz" | cut -f1) n8n=$(du -h "$DIR/n8n-$STAMP.sql.gz" | cut -f1) total=$(du -sh "$DIR" | cut -f1)"
