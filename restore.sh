#!/bin/sh
# Restore a backup made by backup.sh into a new (or clean) deployment of this bundle.
#   sh restore.sh backups/20260101-020000
# Not yet exercised on a real deployment.
set -eu
cd "$(dirname "$0")"
SRC="${1:-}"
[ -d "$SRC" ] || { echo "Usage: sh restore.sh backups/<folder>" >&2; exit 1; }
printf "This replaces the current database and storage. Type YES to continue: "
read -r A; [ "$A" = "YES" ] || exit 1

# .env must be the one saved with the backup (JWT_SECRET etc.), otherwise sessions/encryption break.
[ -f .env ] || cp "$SRC/env.backup" .env
cmp -s .env "$SRC/env.backup" || echo "Warning: the current .env differs from the one saved in the backup."

docker compose up -d --wait db
docker compose stop app auth rest realtime storage api-gw || true
docker compose exec -T db pg_restore -U supabase_admin -d postgres \
  --clean --if-exists --no-owner < "$SRC/db.dump" || echo "(pg_restore warnings above are usually harmless; review them)"
rm -rf volumes/storage
tar -C volumes -xzf "$SRC/storage.tar.gz"
docker compose up -d --wait
echo "Restore complete."
