#!/bin/sh
# Self-check for a Sho-ERP deployment. It only reads and probes; it changes
# nothing (apart from one request to the app's home page, which starts the
# database schema installation if that has not started yet - it does not: see below).
#
#   sh doctor.sh          full check, then a summary with fixes
#   sh doctor.sh --wait   also waits until the schema is installed (used by install.sh)
#
# Exit code: 0 = working, 1 = at least one problem prevents it from working.
# Warnings do not change the exit code.
set -u
cd "$(dirname "$0")"

WAIT=0
[ "${1:-}" = "--wait" ] && WAIT=1

BAD=0
WARN=0
ok() { printf '  [ OK ]  %s\n' "$1"; }
warn() { WARN=$((WARN + 1)); printf '  [WARN]  %s\n' "$1"; [ -n "${2:-}" ] && printf '          -> %s\n' "$2"; }
bad() { BAD=$((BAD + 1)); printf '  [FAIL]  %s\n' "$1"; [ -n "${2:-}" ] && printf '          -> %s\n' "$2"; }
title() { printf '\n== %s ==\n' "$1"; }

envval() { # KEY -> last value in .env, without quotes
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

# -- 0. Requirements -----------------------------------------------------------
title "Requirements"
if ! command -v docker >/dev/null 2>&1; then
  bad "Docker is not installed." "Install Docker (or Container Manager on Synology), then run this check again."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  bad "docker compose (v2) is not available." "Update Docker to a version that includes compose v2."
  exit 1
fi
ok "Docker and compose are available."

if [ ! -f .env ]; then
  bad ".env file not found." "Run: sh install.sh"
  exit 1
fi
ok ".env file found."

for k in JWT_SECRET ANON_KEY SERVICE_ROLE_KEY POSTGRES_PASSWORD SECRET_KEY_BASE; do
  if [ -z "$(envval "$k")" ]; then
    bad "$k is empty in .env." "Secrets were not generated. Run: sh install.sh (it never replaces existing secrets)."
  fi
done

FREE_KB=$(df -Pk . 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "${FREE_KB:-}" ]; then
  if [ "$FREE_KB" -lt 1048576 ]; then
    bad "Less than 1 GB of free disk space." "Keep at least 5 GB free for the database and uploaded files."
  elif [ "$FREE_KB" -lt 5242880 ]; then
    warn "Less than 5 GB of free disk space." "The database and files grow over time; add space."
  else
    ok "Enough free disk space."
  fi
fi

# -- 1. Containers -------------------------------------------------------------
# `sh install.sh --supabase-only` records the mode: Supabase alone, with no app container.
MODE=$(envval SHO_MODE)
sql() { docker compose exec -T db psql -U postgres -d postgres -tA -c "$1" 2>/dev/null | tr -d '[:space:]'; }
title "Containers"
svc_state() {
  id=$(docker compose ps -q "$1" 2>/dev/null | head -n 1)
  if [ -z "$id" ]; then echo missing; return; fi
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo unknown
}
APP_UP=0
SERVICES="db api-gw auth rest realtime storage app"
[ "$MODE" = supabase-only ] && SERVICES="db api-gw auth rest realtime storage"
for s in $SERVICES; do
  st=$(svc_state "$s")
  case "$st" in
    healthy | running) ok "$s is up ($st)."; [ "$s" = app ] && APP_UP=1 ;;
    starting) warn "$s is still starting." "Wait 2-3 minutes (the first start is slow on slow disks), then run: sh doctor.sh" ;;
    missing) bad "$s is not created." "Run: docker compose up -d --wait" ;;
    unhealthy) bad "$s is unhealthy." "It may still be initialising on a slow disk: wait 2-3 minutes, then run: docker compose up -d --wait. If it stays unhealthy, read: docker compose logs $s --tail 40" ;;
    *) bad "$s state: $st." "Read its log: docker compose logs $s --tail 40" ;;
  esac
done
if [ "$MODE" = supabase-only ]; then
  # -- Supabase only: there is no app to probe from, so check what an app will rely on.
  title "Supabase only (no app)"
  if [ "$(sql 'select 1')" = "1" ]; then
    ok "The database accepts connections."
  else
    bad "Cannot connect to the database." "docker compose logs db --tail 40"
  fi
  schemas=$(sql "select count(*) from information_schema.schemata where schema_name in ('auth','storage')")
  if [ "$schemas" = "2" ]; then
    ok "The auth and storage schemas exist."
  else
    bad "The auth and storage schemas are missing." "Their services create them when they start: docker compose logs auth storage --tail 40"
  fi
  GW_PORT=$(envval API_GW_HTTP_PORT)
  [ -z "$GW_PORT" ] && GW_PORT=8000
  if command -v curl >/dev/null 2>&1; then
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "apikey: $(envval ANON_KEY)" "http://127.0.0.1:$GW_PORT/auth/v1/health" || true)
    case "$code" in
      200) ok "The gateway answers (auth through port $GW_PORT)." ;;
      000) bad "The gateway does not answer on port $GW_PORT." "docker compose ps; docker compose logs api-gw --tail 40" ;;
      *) bad "The gateway answered $code for the sign-in health check." "docker compose logs auth api-gw --tail 40" ;;
    esac
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:$GW_PORT/rest/v1/" || true)
    case "$code" in
      401 | 403) ok "The gateway refuses a request without a key." ;;
      000) : ;;
      *) bad "The gateway answered $code to a request without a key." "It must refuse (401/403). Check ANON_KEY and SERVICE_ROLE_KEY in .env." ;;
    esac
  else
    warn "curl is not installed here: the gateway was not probed." "Open the Project URL in a browser: /auth/v1/health should answer {\"message\":\"No API key found...\"}."
  fi
  DBB=$(envval DB_BIND)
  NET=$(envval SUPABASE_NETWORK)
  [ -z "$NET" ] && NET=sho-supabase
  if [ -z "$DBB" ]; then
    ok "No database port is published; the app reaches it on the Docker network \"$NET\" as $NET-db:5432."
  elif [ "$DBB" = "0.0.0.0" ]; then
    warn "The database port is published on every address (DB_BIND=0.0.0.0)." "Only the password protects it and the connection is not encrypted: allow it from the local network only in the firewall, never from the internet."
  else
    ok "The database port is published on $DBB:$(envval DB_PORT) only."
  fi
  title "Summary"
  if [ "$BAD" -eq 0 ] && [ "$WARN" -eq 0 ]; then
    printf '  Everything is fine.\n'
  elif [ "$BAD" -eq 0 ]; then
    printf '  Supabase works. %s warning(s) above are worth a look.\n' "$WARN"
  else
    printf '  %s problem(s) and %s warning(s). Start with the first [FAIL] above, then run: sh doctor.sh\n' "$BAD" "$WARN"
  fi
  [ "$BAD" -eq 0 ] && exit 0 || exit 1
fi

if [ "$APP_UP" -ne 1 ]; then
  printf '\nThe app container is not running, so the in-container checks are skipped.\n'
  printf 'Result: %s problem(s), %s warning(s).\n' "$BAD" "$WARN"
  [ "$BAD" -eq 0 ] && exit 0 || exit 1
fi

# -- 2. Addresses --------------------------------------------------------------
title "Addresses in .env"
PUB=$(envval SUPABASE_PUBLIC_URL)
SITE=$(envval SITE_URL)
EXT=$(envval API_EXTERNAL_URL)
INTERNAL=$(envval SUPABASE_INTERNAL_URL)
[ -z "$INTERNAL" ] && INTERNAL="http://api-gw:8000"
case "$PUB" in
  *localhost* | *127.0.0.1*) warn "SUPABASE_PUBLIC_URL points to localhost ($PUB)." "Only the server itself can open that. Use the address your users type." ;;
esac
pub_scheme=${PUB%%://*}
site_scheme=${SITE%%://*}
if [ "$pub_scheme" != "$site_scheme" ]; then
  if [ "$site_scheme" = "https" ]; then
    warn "The site is https but SUPABASE_PUBLIC_URL is $pub_scheme." \
      "Browsers block an https page from talking to an http gateway (mixed content, red shield). Make the gateway https too, then: docker compose up -d"
  else
    warn "SITE_URL ($site_scheme) and SUPABASE_PUBLIC_URL ($pub_scheme) use different schemes." \
      "Prefer https for both behind a reverse proxy."
  fi
else
  ok "SITE_URL and SUPABASE_PUBLIC_URL use the same scheme ($pub_scheme)."
fi
if [ "$EXT" != "${PUB%/}/auth/v1" ]; then
  warn "API_EXTERNAL_URL is not SUPABASE_PUBLIC_URL + /auth/v1." "Set it to ${PUB%/}/auth/v1 then run: docker compose up -d auth app"
else
  ok "API_EXTERNAL_URL is consistent."
fi

# -- 3. Server connections (from inside the app container) ---------------------
title "App connections (from inside its container)"
probe() { # URL [auth: 0 none, 1 anon key, 2 service key]  -> "200" or "ERR <reason>"
  docker compose exec -T -e PROBE_URL="$1" -e PROBE_AUTH="${2:-0}" app node - <<'JS' 2>/dev/null | tail -n 1
const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const k = process.env.PROBE_AUTH === "2" ? service : anon;
const h = process.env.PROBE_AUTH !== "0" && k ? { apikey: k } : {};
fetch(process.env.PROBE_URL, { headers: h, signal: AbortSignal.timeout(8000) })
  .then((r) => console.log(String(r.status)))
  .catch((e) => console.log("ERR " + ((e.cause && e.cause.code) || e.name || e.message)));
JS
}

r=$(probe "$INTERNAL/auth/v1/health" 1)
case "$r" in
  200) ok "Sign-in service (auth) through the internal gateway: working." ;;
  503) bad "The gateway answers 503 (no healthy service behind it)." "Usually auth/rest/storage are still starting: wait, then run: docker compose up -d --wait. If it persists: docker compose restart api-gw (see docs/DEPLOY.md, IPv4 name resolution)." ;;
  ERR*) bad "The app cannot reach the internal gateway ($INTERNAL): $r." "Check that api-gw is healthy: docker compose ps. If so: docker compose restart api-gw" ;;
  *) bad "Sign-in service through the gateway answered: $r." "Read: docker compose logs auth --tail 40" ;;
esac

r=$(probe "$INTERNAL/rest/v1/" 2)
case "$r" in
  200) ok "Data API (rest) through the internal gateway: working." ;;
  503) bad "The data API answers 503." "docker compose restart api-gw, then: docker compose logs rest --tail 40" ;;
  ERR*) bad "Data API: $r." "docker compose ps, then: docker compose logs api-gw --tail 40" ;;
  *) warn "The data API answered: $r." "The schema may not be installed yet; see the database section below." ;;
esac

r=$(probe "$INTERNAL/storage/v1/status" 1)
case "$r" in
  200) ok "Storage: working." ;;
  *) warn "Storage answered: $r." "Read: docker compose logs storage --tail 40" ;;
esac

r=$(probe "${PUB%/}/auth/v1/health" 1)
case "$r" in
  200) ok "The public address ${PUB%/} is reachable from inside the container (not required, but nice)." ;;
  ERR*) warn "The container cannot reach the public address ($r)." "Normal behind a proxy on another network: the app uses the internal address. But make sure your browser can open the public address." ;;
  *) warn "The public address answered $r from inside the container." "Check the reverse-proxy host: destination must be http with the right port, with WebSocket enabled." ;;
esac

LIC=$(envval LICENSE_SERVER_URL)
[ -z "$LIC" ] && LIC="https://shoerp.yahiacloud.com"
r=$(probe "$LIC" 0)
case "$r" in
  ERR*) warn "The container cannot reach the license server ($LIC): $r." "Check the server's internet access and firewall. Without it the license code cannot be activated." ;;
  *) ok "The license server is reachable from the container ($r)." ;;
esac

# -- 4. Database ---------------------------------------------------------------
title "Database"

if [ "$(sql 'select 1')" = "1" ]; then
  ok "The database accepts connections."
else
  bad "Cannot connect to the database." "docker compose logs db --tail 40"
fi

schema_ready() { [ "$(sql "select count(*) from public.schema_migrations")" -gt 0 ] 2>/dev/null; }

if ! schema_ready; then
  # NOTE: a plain HTTP request does NOT start the installation. The app starts it when the /setup
  # page is opened in a browser (its script calls the server). This request only checks the app answers.
  docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/',{headers:{accept:'text/html'},signal:AbortSignal.timeout(15000)}).then((r)=>r.arrayBuffer()).catch(()=>{})" >/dev/null 2>&1 || true
  if [ "$WAIT" -eq 1 ]; then
    printf '  ... waiting for the schema installation (can take minutes on slow disks)'
    i=0
    while [ "$i" -lt 60 ] && ! schema_ready; do
      printf '.'
      sleep 3
      i=$((i + 1))
    done
    printf '\n'
  fi
fi
if schema_ready; then
  n=$(sql "select count(*) from public.schema_migrations")
  ok "The schema is installed ($n migrations)."
  count_admins() { sql "select count(*) from public.user_roles where role = 'admin'"; }
  if [ "$WAIT" -eq 1 ]; then
    i=0
    while [ "$i" -lt 30 ] && ! [ "$(count_admins)" -ge 1 ] 2>/dev/null; do
      [ "$i" -eq 0 ] && printf '  ... waiting for the first administrator to be created'
      printf '.'
      sleep 3
      i=$((i + 1))
    done
    [ "$i" -gt 0 ] && printf '\n'
  fi
  admins=$(count_admins)
  if [ "${admins:-0}" -ge 1 ] 2>/dev/null; then
    ok "A system administrator exists."
  else
    warn "No system administrator yet." "Open the app: the default administrator is created on the first request. If it does not appear: docker compose restart app"
  fi
  mail=$(sql "select coalesce(bool_or(enabled), false) from public.email_settings")
  if [ "$mail" = "t" ]; then
    ok "Email is enabled inside the app."
  else
    warn "Email is not configured." "Settings > Email: set SMTP and enable it, otherwise password recovery by email will not work (the recovery code still does)."
  fi
else
  warn "The schema is not installed yet." "Open the app address in a browser: that starts the installation. Then run: sh doctor.sh --wait"
fi

# -- Summary -------------------------------------------------------------------
title "Summary"
if [ "$BAD" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  printf '  Everything is fine.\n'
elif [ "$BAD" -eq 0 ]; then
  printf '  The system works. %s warning(s) above are worth a look.\n' "$WARN"
else
  printf '  %s problem(s) prevent it from working and %s warning(s). Start with the first [FAIL] above, then run: sh doctor.sh\n' "$BAD" "$WARN"
fi
[ "$BAD" -eq 0 ]
