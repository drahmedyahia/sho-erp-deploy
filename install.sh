#!/bin/sh
# Installs Sho-ERP with its trimmed Supabase stack. Safe to re-run: it never
# replaces existing secrets.
#
#   sh install.sh [--project NAME] [--image-tag TAG] [PUBLIC_API_URL] [SITE_URL]
#   sh install.sh --supabase-only [options] [PUBLIC_API_URL]
#
# Examples:
#   sh install.sh http://192.168.1.10:8000 http://192.168.1.10:3000      (LAN test)
#   sh install.sh https://api.example.com https://erp.example.com        (behind a reverse proxy)
#
# --project NAME sets the Compose project (stack) name, the prefix of the container and volume names
# (COMPOSE_PROJECT_NAME in .env; sho-erp by default). Give each installation on one server its own.
#
# --image-tag TAG pins the app image to one release (for example v1.0.0) instead of :latest: it
# writes APP_IMAGE in .env as <the image in .env.example>:TAG. Not for --supabase-only (no app).
#
# --supabase-only installs the Supabase containers alone (database, auth, rest, realtime, storage
# and the API gateway), without the app, and prints the connection details to type into the
# /setup screen of an app installed separately. Options:
#   --network NAME     Docker network of the project (default sho-supabase). The app joins it and
#                      reaches the database as NAME-db:5432: no database port is published.
#   --db-bind ADDRESS  publish the database port on ADDRESS instead (127.0.0.1 for a program on
#                      this server or an SSH tunnel, the gateway address of a Docker network, e.g.
#                      172.17.0.1, for a container, 0.0.0.0 for another machine).
#   --db-port PORT     the published port (default 55432; the next free one is used if it is taken)
#   --db-host ADDRESS  the address the app uses in the database URL when it differs from
#                      --db-bind (needed with --db-bind 0.0.0.0: the server's own address)
set -eu
cd "$(dirname "$0")"

die() { echo "Error: $*" >&2; exit 1; }

SUPABASE_ONLY=0
PROJECT=""
IMAGE_TAG=""
NETWORK=sho-supabase
DB_BIND_OPT=""
DB_PORT_OPT=""
DB_HOST_OPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --supabase-only) SUPABASE_ONLY=1 ;;
    --project) [ $# -ge 2 ] || die "--project needs a value."; PROJECT="$2"; shift ;;
    --image-tag) [ $# -ge 2 ] || die "--image-tag needs a value."; IMAGE_TAG="$2"; shift ;;
    --network) [ $# -ge 2 ] || die "--network needs a value."; NETWORK="$2"; shift ;;
    --db-bind) [ $# -ge 2 ] || die "--db-bind needs a value."; DB_BIND_OPT="$2"; shift ;;
    --db-port) [ $# -ge 2 ] || die "--db-port needs a value."; DB_PORT_OPT="$2"; shift ;;
    --db-host) [ $# -ge 2 ] || die "--db-host needs a value."; DB_HOST_OPT="$2"; shift ;;
    --) shift; break ;;
    -*) die "unknown option: $1" ;;
    *) break ;;
  esac
  shift
done
if [ "$SUPABASE_ONLY" -eq 0 ] && { [ -n "$DB_BIND_OPT" ] || [ -n "$DB_PORT_OPT" ] || [ -n "$DB_HOST_OPT" ] || [ "$NETWORK" != sho-supabase ]; }; then
  die "--network, --db-bind, --db-port and --db-host go with --supabase-only."
fi
if [ -n "$IMAGE_TAG" ]; then
  [ "$SUPABASE_ONLY" -eq 0 ] || die "--image-tag is for the app image; --supabase-only installs no app."
  printf '%s' "$IMAGE_TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' \
    || die "--image-tag: letters, digits and . _ - only (for example v1.0.0)."
fi
if [ -n "$PROJECT" ]; then
  printf '%s' "$PROJECT" | grep -Eq '^[a-z0-9][a-z0-9_-]{0,62}$' \
    || die "--project: lower-case letters, digits, - and _ only."
fi
if [ "$SUPABASE_ONLY" -eq 1 ]; then
  printf '%s' "$NETWORK" | grep -Eq '^[a-z0-9][a-z0-9_.-]{0,62}$' \
    || die "--network: lower-case letters, digits and . _ - only."
  if [ -n "$DB_BIND_OPT" ]; then
    printf '%s' "$DB_BIND_OPT" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || die "--db-bind must be an IPv4 address."
  else
    [ -z "$DB_PORT_OPT" ] && [ -z "$DB_HOST_OPT" ] || die "--db-port and --db-host need --db-bind."
  fi
  if [ -n "$DB_PORT_OPT" ]; then
    printf '%s' "$DB_PORT_OPT" | grep -Eq '^[0-9]{1,5}$' && [ "$DB_PORT_OPT" -ge 1 ] && [ "$DB_PORT_OPT" -le 65535 ] \
      || die "--db-port must be a port number (1-65535)."
  fi
  if [ -n "$DB_HOST_OPT" ]; then
    printf '%s' "$DB_HOST_OPT" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' || die "--db-host must be an address or a name."
  fi
  [ "$DB_BIND_OPT" != 0.0.0.0 ] || [ -n "$DB_HOST_OPT" ] || die "--db-bind 0.0.0.0 needs --db-host: the server's address as the app reaches it."
fi

command -v docker >/dev/null 2>&1 || die "Docker is not installed."
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available."

if [ -f .env ] && grep -q '^JWT_SECRET=.\+' .env; then
  echo "* .env already has generated secrets - keeping them."
else
  [ -f .env ] || cp .env.example .env
  echo "* Generating secrets..."
  sh utils/generate-keys.sh --update-env >/dev/null
  rm -f .env.old
fi

set_env() { # KEY VALUE
  if grep -q "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

API_URL="${1:-}"
SITE="${2:-}"
if [ "$SUPABASE_ONLY" -eq 1 ] && [ -n "$SITE" ]; then
  die "--supabase-only takes only the public address of the API gateway (there is no app)."
fi
if [ -z "$API_URL" ]; then
  if [ -t 0 ]; then
    printf "Public address of the API gateway [http://localhost:8000]: "
    read -r API_URL
  fi
  API_URL="${API_URL:-http://localhost:8000}"
fi
API_URL="${API_URL%/}"
if [ "$SUPABASE_ONLY" -eq 1 ]; then
  SITE="$API_URL" # no app: the address in e-mail links is only a placeholder until one is linked
elif [ -z "$SITE" ]; then
  SITE="$(printf '%s' "$API_URL" | sed -E 's|:[0-9]+$||'):3000"
  [ "$API_URL" = "http://localhost:8000" ] && SITE="http://localhost:3000"
fi
[ -z "$PROJECT" ] || set_env COMPOSE_PROJECT_NAME "$PROJECT"
if [ -n "$IMAGE_TAG" ]; then
  # The image's name without its tag, from .env (or the default docker-compose.yml names).
  CUR_IMAGE="$(sed -n 's/^APP_IMAGE=//p' .env | head -n 1)"
  [ -n "$CUR_IMAGE" ] || CUR_IMAGE="$(sed -n 's/.*APP_IMAGE:-\(.*\)}.*/\1/p' docker-compose.yml | head -n 1)"
  [ -n "$CUR_IMAGE" ] || die "cannot tell which app image to pin."
  IMAGE_LAST="${CUR_IMAGE##*/}"
  set_env APP_IMAGE "${CUR_IMAGE%"$IMAGE_LAST"}${IMAGE_LAST%%:*}:$IMAGE_TAG"
fi
set_env SUPABASE_PUBLIC_URL "$API_URL"
set_env API_EXTERNAL_URL "$API_URL/auth/v1"
set_env SITE_URL "$SITE"
set_env DISABLE_SIGNUP true

# Is this TCP port already taken on this server? (Docker-published ports first, then what the
# system can tell; when nothing can tell, assume it is free and let Docker report a conflict.)
port_busy() {
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -Eq "(^|[ ,])[0-9.:]*:$1->" && return 0
  if command -v ss >/dev/null 2>&1; then ss -ltn 2>/dev/null | grep -Eq "[:.]$1[[:space:]]" && return 0; return 1; fi
  if command -v netstat >/dev/null 2>&1; then netstat -ltn 2>/dev/null | grep -Eq "[:.]$1[[:space:]]" && return 0; return 1; fi
  if command -v bash >/dev/null 2>&1; then (bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" >/dev/null 2>&1) && return 0; fi
  return 1
}

if [ "$SUPABASE_ONLY" -eq 1 ]; then
  set_env SHO_MODE supabase-only
  set_env SUPABASE_NETWORK "$NETWORK"
  COMPOSE_FILE_VALUE="docker-compose.yml:docker-compose.supabase-only.yml"
  DB_URL_HOST="$NETWORK-db"
  DB_URL_PORT=5432
  if [ -n "$DB_BIND_OPT" ]; then
    PORT="${DB_PORT_OPT:-55432}"
    if port_busy "$PORT"; then
      [ -z "$DB_PORT_OPT" ] || die "port $PORT is already in use on this server. Choose another with --db-port."
      first=$PORT
      while port_busy "$PORT"; do
        PORT=$((PORT + 1))
        [ "$PORT" -le 65535 ] && [ "$PORT" -lt $((first + 50)) ] || die "no free port found near $first. Choose one with --db-port."
      done
      echo "* Port $first is already in use on this server: publishing the database on $PORT instead."
    fi
    set_env DB_BIND "$DB_BIND_OPT"
    set_env DB_PORT "$PORT"
    COMPOSE_FILE_VALUE="$COMPOSE_FILE_VALUE:docker-compose.supabase-db-port.yml"
    DB_URL_HOST="${DB_HOST_OPT:-$DB_BIND_OPT}"
    DB_URL_PORT="$PORT"
  fi
  # `docker compose` reads COMPOSE_FILE from .env, so doctor.sh, backup.sh and the daily commands
  # use the same files without an extra argument.
  set_env COMPOSE_FILE "$COMPOSE_FILE_VALUE"
fi

mkdir -p volumes/db/data volumes/storage volumes/snippets backups

docker compose config -q || die "docker-compose.yml or .env is not valid."
echo "* Starting the services (images are pulled on the first run, which can take a while)..."
docker compose pull
if ! docker compose up -d --wait; then
  echo
  echo "Not every container became healthy. Diagnostic check:"
  sh doctor.sh || true
  echo "If the containers are still initialising, wait a minute and run: docker compose up -d --wait"
  exit 1
fi

echo
echo "Final check..."
sh doctor.sh || true

if [ "$SUPABASE_ONLY" -eq 1 ]; then
  PW=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -n 1)
  ANON=$(sed -n 's/^ANON_KEY=//p' .env | tail -n 1)
  SERVICE=$(sed -n 's/^SERVICE_ROLE_KEY=//p' .env | tail -n 1)
  cat <<MSG

Done: Supabase is running (no app). Enter these in the /setup screen of your app:

  Database URL : postgresql://postgres:$PW@$DB_URL_HOST:$DB_URL_PORT/postgres
  Project URL  : $API_URL
  Public key   : $ANON
  Service key  : $SERVICE      (highly secret)

MSG
  if [ -z "$DB_BIND_OPT" ]; then
    cat <<MSG
Your app must be a Docker container on THIS server that joins the network "$NETWORK". Add to its
compose file (keep the networks it already has, for example the reverse proxy's):

  services:
    your-app-service:
      networks:
        - default
        - supabase
      environment:
        # optional, recommended: the app's own calls to Supabase stay inside this network
        SUPABASE_INTERNAL_URL: http://api-gw:8000
  networks:
    supabase:
      external: true
      name: $NETWORK

No database port is published. To publish one instead (an app outside Docker, a tunnel, another
machine), run again with: sh install.sh --supabase-only --db-bind 127.0.0.1
MSG
  else
    cat <<MSG
The database port is published on $DB_BIND_OPT:$DB_URL_PORT. Never open it to the internet: only the
password protects it, and the connection is not encrypted.
MSG
  fi
  cat <<MSG

- Point your reverse proxy at the gateway port ($(sed -n 's/^API_GW_HTTP_PORT=//p' .env | tail -n 1)) for $API_URL (WebSocket on, https).
- Keep a copy of .env somewhere safe: losing it means losing the ability to decrypt stored data.
- If something does not work, run: sh doctor.sh
MSG
  exit 0
fi

cat <<MSG

Done. Open: $SITE
- Open that address IN A BROWSER: that is what starts installing the database schema (a plain HTTP
  request does not). It takes a few minutes, then the administrator sign-in screen appears.
  To follow it from here: sh doctor.sh --wait
- Email (password recovery and notifications): inside the app, Settings > Email.
- Studio (optional): docker compose --profile admin up -d   ->  $API_URL
  Username/password: DASHBOARD_USERNAME / DASHBOARD_PASSWORD in .env
- Keep a copy of .env somewhere safe: losing it means losing the ability to decrypt stored data.
- If something does not work, run: sh doctor.sh
MSG
