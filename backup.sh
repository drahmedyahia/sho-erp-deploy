#!/bin/sh
# Backup: a logical dump of the database + the storage files + .env, all in one
# dated folder under backups/. Does not stop the service. Not yet exercised on a
# real deployment - try restore.sh on a test copy first.
set -eu
cd "$(dirname "$0")"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="backups/$TS"
mkdir -p "$OUT"
umask 077

docker compose exec -T db pg_dump -U supabase_admin -d postgres -Fc \
  --exclude-schema=_realtime > "$OUT/db.dump"
tar -C volumes -czf "$OUT/storage.tar.gz" storage
cp .env "$OUT/env.backup"
KEEP="${BACKUP_KEEP:-14}"
ls -1d backups/*/ 2>/dev/null | sort -r | awk -v k="$KEEP" 'NR>k' | while read -r d; do rm -rf "$d"; done
echo "Done: $OUT"
