# Sho-ERP deployment bundle

[العربية](README.ar.md) · **English**

One folder that runs Sho-ERP together with the Supabase services it needs:
the app plus six Supabase containers (`db`, `auth`, `rest`, `realtime`, `storage`, `api-gw`).
Studio and `meta` (a database admin UI) are optional. Not included, because the app does not use them:
edge functions, image proxy, connection pooler, analytics and log shipping.

## Quick start

Every way of installing is in the generator: <https://shoerp.sho-labs.com> (or `generator.html` in this folder, which
needs no internet). You choose **Everything** or **Separate**, then **script** or **compose**, and it gives you
exactly what that way needs: the SSH command with its prerequisites, or the compose file and `.env` with the connection
details. The same commands, for reference:

|                                                    | **By script** (SSH, inside the `deploy/` folder)                     | **By compose** (Dockge, Portainer, a GUI)                               |
| -------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **A. Everything** (app + Supabase)                 | `sudo sh install.sh https://api.example.com https://erp.example.com` | the generator, **Everything**: `compose.yaml` + `.env`                  |
| **B. Supabase on its own** (link the app yourself) | `sudo sh install.sh --supabase-only https://api.example.com`         | the generator, **Supabase only**: `supabase-only.compose.yaml` + `.env` |

Options of **B** (the generator picks them for you from where your app runs; details in _Two ways to deploy_):

```sh
sudo sh install.sh --supabase-only --db-bind 172.17.0.1 https://api.example.com   # also publish the database port there
sudo sh install.sh --supabase-only --network second https://api.example.com        # a second Supabase on the same server
```

Before the script: Docker with Compose v2 on the server and this `deploy/` folder copied to it (steps 1 to 3 below).
The script and the compose files each make their own secrets: use one way per installation, never both.

## Requirements

- Docker with Compose v2 (Container Manager on Synology DSM), x86_64.
- About 2 GB of RAM and 5 GB of free disk for a small installation.
- Outbound internet access from the server: pulling images and activating the license code.

## Step by step on any server

These steps are the same on any Linux server (a VPS, a cloud VM, a machine in your office, a NAS that
runs Docker). Only the way you reach the machine and the reverse proxy differ.

1. **Connect over SSH** from your computer (use PuTTY or Windows Terminal on Windows):

   ```sh
   ssh <user>@<server address>          # add -p <port> if SSH does not listen on 22
   ```

   Commands that manage Docker need administrator rights: either prefix them with `sudo`, or open a root
   shell once with `sudo -i`. On some NAS systems SSH is off by default; enable it in the system settings.

2. **Install Docker** with Compose v2, unless it is already there. Check with `docker --version` and
   `docker compose version`. Official instructions: <https://docs.docker.com/engine/install/>.

3. **Copy this `deploy/` folder to the server** into a folder you will keep (the data lives inside it):

   ```sh
   scp -r deploy <user>@<server address>:/opt/sho-erp          # from your computer
   # or, on the server (the public deploy repository holds only this folder):
   git clone --depth 1 https://github.com/drahmedyahia/sho-erp-deploy.git /opt/sho-erp/deploy
   ```

4. **Log in to the image registry**, only if you use a private image (the official image is public and needs no
   login). You are then given a user name and an access token (permission `read:packages`) with your license. Type the token at the prompt, never in
   the command line:

   ```sh
   sudo docker login ghcr.io -u <user name>
   ```

   Log in with the same user that runs the installer (`sudo` above matches `sudo sh install.sh`). The error
   `unauthorized` while pulling means this step is missing or was done as another user.

5. **Check that the ports are free** (3000 for the app, 8000 for the gateway). If another program uses
   them, set `APP_PORT` and `API_GW_HTTP_PORT` in `.env` first (copy `.env.example` to `.env`):

   ```sh
   docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E ':3000->|:8000->'
   netstat -ltn | grep -E ':3000 |:8000 '      # or: ss -ltn (not installed on every system)
   ```

6. **Install**, using the two public names you will give users (see _Addresses and the reverse proxy_):

   ```sh
   cd /opt/sho-erp
   sudo sh install.sh https://api.example.com https://erp.example.com
   ```

7. **Create the reverse proxy** for the two names (any proxy; `Caddyfile.example` is a ready one) and open
   the firewall for 80 and 443 only. Do not publish ports 3000, 8000 or the database to the internet.

8. **Verify**: `sudo sh doctor.sh` should end without `[FAIL]`. Then open the app address **in a browser** (that starts installing the database).

Every installation is independent: its own folder, its own `.env`, its own database. Several
installations can share one server if each has its own folder and its own ports.

## Install

1. Copy this `deploy/` folder to the server.
2. Run the installer with the public address of the API gateway, then the address of the app:

   ```sh
   sh install.sh https://api.example.com https://erp.example.com
   ```

   For a quick LAN test you can use plain addresses instead: `sh install.sh http://192.168.1.10:8000 http://192.168.1.10:3000`

The installer generates all secrets into `.env` (never replacing existing ones), closes public sign-up,
pulls the images, starts everything and runs a final self-check. **The first start can take several
minutes on a slow disk** (each service runs its own first-time migrations); the installer waits for it.

When it finishes, open the app address **in a browser**: that is what starts installing the database schema
(a few minutes; a plain HTTP request such as `curl` does not start it). The first administrator is `admin@local.com` with the temporary
password `admin1234`; you are forced to choose a new password at the first sign-in. Then enter the
license code you were given.

## Install without SSH (Dockge, Portainer, a GUI)

If you manage Docker from a web interface, you do not need a terminal at all. Two files are enough:

1. Open **`generator.html`** (download it from this folder and double-click it; or use the hosted copy of the
   same page: <https://shoerp.sho-labs.com>). It runs only in your browser: secrets are generated there and never sent
   anywhere. Enter your two public addresses and click **Generate**.
2. In your interface create a new project/stack and paste the two files it shows: **`compose.yaml`** (the same
   as `standalone/compose.yaml` in this folder) and **`.env`**. Then deploy. The page lists the exact clicks for
   Dockge, Portainer and Synology Container Manager.

Differences from the terminal install above:

- It needs **Docker Compose v2** (`docker compose version`); the configuration files are embedded in `compose.yaml`
  (the database and gateway containers write them when they start), so nothing else has to be uploaded.
- Data lives in **named volumes** (`db-data`, `storage-data`, `app-data`) that Docker manages (on Synology under
  `/volume1/@docker/volumes/<project>_<name>/_data`; `docker volume inspect <name>` shows the path), instead of
  `./volumes`, so `backup.sh`, `restore.sh` and `upgrade.sh` do not apply. Use the app's own backup screen, or back
  up the volumes with Docker.
- Prefer to see your data? In the page's **Advanced options** type a **data folder** (an absolute path such as
  `/volume1/docker/sho-erp/data`). The database then lives in `db/` and the files in `storage/` inside it. Create
  both folders **first** (`sudo mkdir -p <folder>/db <folder>/storage`; the page shows the exact command): Docker does
  not create them and the deployment fails with _Bind mount failed ... does not exist_. They must be on the machine that runs Docker. It writes
  `DB_DATA` and `STORAGE_DATA` into `.env`; remove those two lines to go back to named volumes (this does not move
  data already stored). The app's small settings volume (`app-data`) always stays a named volume.
- **Take both files, and the connection details, from one click on Generate.** Every click makes entirely new secrets,
  and the database keeps the ones it was first started with, so a `.env` from one click with a card from another cannot
  work. The page shows a six-character **fingerprint** of the generation, and the first line of the `.env` carries it:
  on the server `head -n 1 .env` must show the same code. If it differs, start again from one generation (and, if the
  database already started, empty its data folder first).
- **Save the `.env`** the page shows once: it is not stored anywhere else, and losing it means losing the ability to
  decrypt stored data.
- Only if you use a private image (the official one is public), log in to the registry once on the server (`docker login ghcr.io`).
- **Pin a version**: the app image is `:latest` unless you say otherwise. To stay on one release, set `APP_IMAGE=ghcr.io/drahmedyahia/sho-erp-release:v1.0.0` in `.env` (the generator has an "App version" field that writes it, and `sh install.sh --image-tag v1.0.0 ...` does the same for the script way). A pinned version does not change when you run `upgrade.sh`.

`generator.html` and the two files in `standalone/` are generated from `docker-compose.yml` and `volumes/` by
`node utils/build-standalone.mjs` (a test fails when they are out of date), so both ways install the same system.

## Two ways to deploy, each by script or by compose

|                                           | **A. Everything (app + Supabase)**                | **B. Supabase on its own, the app linked separately**                                    |
| ----------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **By script** (a terminal on the server)  | `sh install.sh`                                   | `sh install.sh --supabase-only`                                                          |
| **By compose** (Dockge, Portainer, a GUI) | `standalone/compose.yaml` (made by the generator) | `standalone/supabase-only.compose.yaml` (made by the generator)                          |
| What runs                                 | The app and the six Supabase containers           | Only the Supabase containers (database, auth, rest, realtime, storage, gateway)          |
| Connection details                        | Generated into `.env`, nothing to type            | Printed (script) or shown in a card (generator); typed once in the app's `/setup` screen |
| Best for                                  | One customer or server; simplest                  | A Supabase you want apart from the app, or an app already installed                      |

**A** is what the sections above describe (script: Install; compose: Install without SSH).

**B** has two steps: create Supabase (below), then link the app to it on its `/setup` screen.

**B is the recommended way when the app will be updated often**, because the database lives in its own stack:

- Updating the app is "pull the new image and redeploy the app's stack". Supabase is not stopped, restarted or
  even touched, so there is no moment in an update when the data can be at risk and no waiting for the database to
  start again (on a slow disk that wait is minutes).
- The app's stack can be stopped, redeployed, rolled back to an older image or removed (even by mistake: a stray
  `docker compose down`, a wrong folder, a stack deleted from the interface) without the database or its volumes.
- Supabase changes only when you decide to update it, as its own deliberate step with its own backup (`backup.sh`).
  In A one stack holds both, so an upgrade of the bundle can recreate the database containers in the same run.
- Each part can be moved, backed up or restored on its own.

A remains the simplest for one server that you rarely change; choose B once the data matters more than the convenience.

### B, step 1: create Supabase on its own

Either way, the first question is **where your app runs**, because it decides how the app reaches the database:

| Where the app runs                                      | How it reaches the database                                                                                | Database port                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **In a Docker container on this server** (recommended)  | The app joins the stack's Docker network and connects to `<network>-db:5432`                               | **none published**, so nothing to clash with and nothing exposed |
| In a container on this server, no change to its compose | A port published on the gateway address of the app's Docker network (`172.17.0.1` for the default network) | published there only                                             |
| On this server outside Docker, or through an SSH tunnel | `127.0.0.1`                                                                                                | published on `127.0.0.1` only                                    |
| On another machine                                      | The server's own address                                                                                   | published on every address: trusted network only                 |

**By compose**: open `generator.html` (or <https://shoerp.sho-labs.com>), choose **Supabase only (no app)**, answer
the question, and create the stack from the two files it shows. The page also shows the **connection card**
(Database URL with the right address already in it, Project URL, public key, service role key) and, for the first row,
the **piece to add to your app's compose** so it joins the network. The files are `standalone/supabase-only.compose.yaml`
(no database port) and `standalone/supabase-only-db-port.compose.yaml` (also publishes it).

**By script**:

```sh
sh install.sh --supabase-only https://api.example.com                      # the app joins the network
sh install.sh --supabase-only --db-bind 172.17.0.1 https://api.example.com # publish on that address
```

Options: `--project NAME` (the Compose project, i.e. the stack name: the prefix of the container and volume names, `sho-erp` by default; it also applies to A), `--network NAME` (the Docker network, `sho-supabase` by default; use another name for a second stack on
the same server), `--db-bind ADDRESS`, `--db-port PORT` (default `55432`; if it is taken the next free port is used
and the script says so), `--db-host ADDRESS` (the address in the database URL when `--db-bind` is `0.0.0.0`). It
prints the connection details and, when the app joins the network, the piece to add to its compose. `doctor.sh`,
`backup.sh` and `upgrade.sh` work as usual (the script writes `COMPOSE_FILE` into `.env`, so plain
`docker compose ...` commands use the same files).

Notes:

- **The stack name.** Dockge and Portainer use the name you give the stack there. In a terminal it is the folder's name,
  unless you set one: the generator's **Project (stack) name** writes `COMPOSE_PROJECT_NAME` in `.env`, and the script
  takes `--project NAME`. Choose it before the first start: changing it later creates a new project (new containers and
  volumes; data kept in a folder you chose stays in that folder).
- The network name also makes the database's name on it (`<name>-db`). Two Supabase stacks on one server need
  two different names.
- A published database port is protected only by its password and is not encrypted: keep it on `127.0.0.1` or on
  a Docker gateway address, and never open it to the internet. If deploying fails with _address already in use_,
  that port is taken: change `DB_PORT` in `.env` (and in the database URL) and deploy again.
- `SUPABASE_INTERNAL_URL: http://api-gw:8000` in the app's environment is optional and recommended (the generator's snippet and
  the script's output include it): the app's own server-side calls to Supabase then stay inside the network. Without it they
  use the public address, which must be reachable from the app's container (for example through an internal DNS that points it
  at your reverse proxy); on a server whose router cannot loop back to its own public address they fail (`fetch failed` in the
  app's log, and the first administrator is never created). Recent app versions also detect this by themselves at start-up and
  when `/setup` saves the connection, and again if the public address stops answering while they run: if it is unreachable but
  `api-gw` answers on the shared network they use it until the next restart (`SUPABASE_INTERNAL_URL_AUTO=off` disables that). Keep the app on the network it already has as well as this one.
- The database is empty (no tables) until the app connects: the app installs its tables the first time.
- Give the stack its own Docker network: do not attach its containers to a network shared with other projects (see
  the warning in Install without SSH).

### B, step 2: link the app (the `/setup` screen)

In the generator, **Supabase only** with the compose tools also builds **your app's compose file** (name, port, data folder,
your reverse proxy's network, whether it joins the Supabase network, a generated `SETUP_TOKEN`), written from the repository's
`docker-compose.yml`; use it as a project of its own, or merge the snippet it shows into the file you already have.

Run only the app image with the repository's root `docker-compose.yml`, and set `SETUP_TOKEN` to a long
random value (for example `openssl rand -hex 24`). Without a token the screen is disabled. Open
`https://<your-app>/setup`, enter the token, then:

| Field             | Where to find it                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database URL      | `postgresql://postgres:<password>@<db host>:5432/postgres`. The **direct** connection, not a pooler. From step 1: the card or the script's output. Supabase Cloud: Project Settings > Database > Connection string (direct). |
| API URL           | The public address of Supabase's API (step 1: the address you gave; Cloud: Project Settings > API).                                                                                                                          |
| Public (anon) key | `ANON_KEY` (step 1) or the `anon` / publishable key (Cloud).                                                                                                                                                                 |
| Service role key  | `SERVICE_ROLE_KEY` (step 1) or the `service_role` / secret key (Cloud).                                                                                                                                                      |
| Project id        | Any label you like (Cloud: the project reference).                                                                                                                                                                           |

The same screen links an app to a Supabase Cloud project, so that case needs no step 1.

Notes:

- Each app needs **its own database**; two apps must not share one.
- The values are saved in `/app/data/connection.json` inside the app container's data volume and **win over
  environment variables**, so keep that volume and back it up. Later, an administrator can change them at
  `/setup?edit=1` without the token.
- Empty `SETUP_TOKEN` again after the setup is done.

## Addresses and the reverse proxy

You do not need to expose IP addresses to users. Put a reverse proxy (Nginx Proxy Manager, Nginx, Caddy,
Traefik) with HTTPS in front and use two names:

| Name              | Forward to (http) | Notes                                          |
| ----------------- | ----------------- | ---------------------------------------------- |
| `erp.example.com` | `<server>:3000`   | HTTPS                                          |
| `api.example.com` | `<server>:8000`   | HTTPS, **WebSocket support on** (live updates) |

Rules that matter:

- The destination scheme is **http**: the containers do not terminate TLS.
- Both names must be **https**. A page served over https cannot talk to an http gateway (the browser
  blocks it as mixed content and shows a red shield).
- If the proxy runs on the same machine, set `APP_BIND=127.0.0.1` and `API_GW_BIND=127.0.0.1` in `.env`.
- A proxy on a macvlan network address cannot reach the host's own LAN address. Forward to the address of
  the Docker network gateway it shares with the host (for example `172.17.0.1`) and the published port. Do not
  work around it by joining the project to the proxy's network (see the warning below).
- Large backup files need no proxy setting: the restore screen uploads them in 4 MB pieces, so no request
  is large. Do not add custom Nginx directives to the host unless you must: an invalid or duplicated
  directive makes Nginx Proxy Manager silently drop the whole host (it still shows "Online", but TLS fails
  with _unrecognized name_).
- **Do not attach the project's containers to a shared Docker network** (for example the reverse proxy's network)
  to reach them by name. Every Supabase project has services called `rest`, `auth`, `db`, `storage` and
  `realtime`; the gateway finds its services by these names, so on a shared network it can connect to a container
  of **another project** and read or write its database. Keep each project on the private network Compose creates
  for it and point the proxy at the published ports (`<host address>:<port>`).
- The app server talks to the gateway directly inside the Docker network (`SUPABASE_INTERNAL_URL`), so
  the proxy is only for browsers.

To change the addresses later, edit `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL` (must end with `/auth/v1`)
and `SITE_URL` in `.env`, then run `docker compose up -d auth app`.

## Everyday commands

```sh
docker compose ps                       # state of every container
docker compose logs -f app              # follow the app log
sh doctor.sh                            # self-check: what is wrong and how to fix it
sh backup.sh                            # database + storage + .env into backups/<date>/
sh restore.sh backups/<folder>          # restore a backup (asks for confirmation)
sh upgrade.sh                           # backup, pull new images, restart
docker compose --profile admin up -d    # start Studio (administrators only)
```

**Try `restore.sh` on a test copy before you rely on the backups.**

## Settings you must complete

- **Email**: inside the app, Settings > Email. Configure SMTP and enable it. The app sends password
  recovery emails itself; the `SMTP_*` variables in `.env` are unused placeholders. Without email,
  recovery works by recovery code only.
- **License**: the app asks for the activation code after the first sign-in and verifies it against the
  license server. The server must be able to reach it over the internet.
- **Studio** (optional) gives full control of the database behind the `DASHBOARD_USERNAME` /
  `DASHBOARD_PASSWORD` in `.env`. Keep it stopped unless you need it.

## Troubleshooting

Run `sh doctor.sh` first; it prints what is wrong and what to do. Common cases:

| Symptom                                                 | Likely cause and fix                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Containers show `unhealthy` right after the first start | Still initialising on a slow disk. Wait 2-3 minutes, then `docker compose up -d --wait`.                 |
| Every request answers 503 within milliseconds           | The gateway cannot find auth/rest. `docker compose restart api-gw`.                                      |
| Sign-in says "invalid credentials" right after install  | The first administrator is still being created; the app shows a "setting up" screen for up to ~90 s.     |
| Red shield / mixed content in the browser               | The site is https but `SUPABASE_PUBLIC_URL` is http. Make both https and run `docker compose up -d`.     |
| "Could not reach the license server"                    | The container has no outbound internet or a firewall blocks it. `sh doctor.sh` shows the exact error.    |
| TLS error _unrecognized name_ on the API name           | The proxy host has no valid configuration (often an invalid custom Nginx directive). Remove it and save. |

## Security notes

- `.env` holds every secret. Keep a copy somewhere safe and never commit it. Losing it means losing the
  ability to decrypt stored data.
- Public sign-up is closed (`DISABLE_SIGNUP=true`); users are created from inside the app.
- Do not publish the database port. If you need an external SQL tool, bind it to `127.0.0.1` only
  (the commented `ports` block under `db`) and tunnel to it. For ad-hoc SQL use
  `docker compose exec db psql -U postgres -d postgres`.

## Files

- `docker-compose.yml`: an excerpt of the official Supabase self-hosted v0.8.0 compose file plus the app.
- `install.sh`, `doctor.sh`, `backup.sh`, `restore.sh`, `upgrade.sh`: operations.
- `.env.example`: configuration template (secrets are generated, never typed).
- `volumes/`: gateway configuration and database initialisation SQL taken from Supabase; see `NOTICE`
  (one deliberate change: IPv4-only name lookups in `volumes/api/envoy/cds.yaml`).
- `Caddyfile.example`: a minimal reverse proxy with automatic HTTPS.
- `generator.html`, `standalone/compose.yaml`, `standalone/supabase-only.compose.yaml`,
  `standalone/supabase-only-db-port.compose.yaml`: the no-SSH install and the Supabase-only stacks (generated by
  `utils/build-standalone.mjs`).
- `docker-compose.supabase-only.yml`, `docker-compose.supabase-db-port.yml`: what `sh install.sh --supabase-only`
  adds to `docker-compose.yml`.
- `LICENSE-supabase`, `NOTICE`: Apache-2.0 attribution for the Supabase-derived files.
