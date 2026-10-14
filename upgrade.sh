#!/bin/sh
# Upgrade: back up, pull the images named in docker-compose.yml/.env, restart.
#   sh upgrade.sh
set -eu
cd "$(dirname "$0")"
sh backup.sh
docker compose pull
docker compose up -d --wait
docker image prune -f >/dev/null
echo "Upgrade complete. Check: docker compose ps (and: sh doctor.sh)"
