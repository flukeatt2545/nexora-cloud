#!/bin/sh
# Keep only the newest deploy backups. Run as the last step of every deploy:
#   sh deploy/prune-backups.sh        # keeps 10
#   sh deploy/prune-backups.sh 15     # keeps 15
#
# A deploy backup is backups/<name>-YYYYMMDD-HHMMSS/ (files.tar.gz, db.dump) plus Docker
# image tags nexora-<service>-backup:<same name>. Newest is decided by the timestamp in the
# name, not file times. Everything else in backups/ and every other *backup* image tag is
# removed. `docker rmi` is not forced, so an image a container still runs is never deleted.
set -eu

KEEP_COUNT=${1:-10}
case $KEEP_COUNT in
  '' | *[!0-9]* | 0) echo "keep count must be a positive number" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/../backups"

keep=$(ls -1d -- *-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9] 2>/dev/null \
  | awk -F- '{ print $(NF-1) $NF " " $0 }' | sort -r | head -n "$KEEP_COUNT" | cut -d' ' -f2-)
if [ -z "$keep" ]; then
  echo "prune-backups: no dated backups found, nothing removed"
  exit 0
fi
is_kept() { printf '%s\n' "$keep" | grep -qxF -- "$1"; }

removed_entries=0
for entry in * .[!.]*; do
  [ -e "$entry" ] || continue
  is_kept "$entry" && continue
  rm -rf -- "./$entry"
  removed_entries=$((removed_entries + 1))
done

removed_tags=0
for ref in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -i backup || true); do
  is_kept "${ref##*:}" && continue
  if docker rmi "$ref" >/dev/null 2>&1; then
    removed_tags=$((removed_tags + 1))
  else
    echo "prune-backups: left $ref (in use or not removable)"
  fi
done

echo "prune-backups: kept $(printf '%s\n' "$keep" | wc -l) backups, removed $removed_entries entries and $removed_tags image tags"
