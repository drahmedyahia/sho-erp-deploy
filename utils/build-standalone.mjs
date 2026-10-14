// Builds the "no SSH" artifacts from the real bundle, so they never drift:
//
//   standalone/compose.yaml  docker-compose.yml with the config files written by the
//                            containers' own start commands and the data folders turned
//                            into named volumes, so ONE file can be pasted into
//                            Dockge / Portainer / a GUI.
//   standalone/supabase-only.compose.yaml
//                            the same without the app: only the Supabase containers, for
//                            an app installed separately (its /setup screen). The app joins
//                            the stack's named Docker network; no database port is published.
//   standalone/supabase-only-db-port.compose.yaml
//                            the same, and the database port is also published (for an app
//                            that cannot join the network: another machine, a tunnel...).
//   generator.html           a page that makes the secrets and the .env in the
//                            browser and shows both files ready to copy.
//
//   node utils/build-standalone.mjs           write the files
//   node utils/build-standalone.mjs --check   fail when they are out of date
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

/**
 * Bind-mounted config files of the bundle. In the single-file stack they are written into the
 * container by its own start command (a shell heredoc), as root, before the real program
 * starts. Compose's `configs` with inline content is not used: it copies the file into the
 * container with settings the stack cannot control (observed: unreadable by the database user,
 * and missing in a folder the image does not have).
 */
const CONFIG_FILES = [
  "volumes/api/envoy/envoy.yaml",
  "volumes/api/envoy/cds.yaml",
  "volumes/api/envoy/lds.template.yaml",
  "volumes/api/envoy/docker-entrypoint.sh",
  "volumes/db/realtime.sql",
  "volumes/db/webhooks.sql",
  "volumes/db/roles.sql",
  "volumes/db/jwt.sql",
].map((f) => `./${f}`);

/**
 * Host data folders -> named volumes. The database and the files can be put in a folder of
 * the user's choice instead: generator.html then writes DB_DATA / STORAGE_DATA (absolute
 * paths) into .env, and `${VAR:-name}` turns the mount into a bind mount; unset, it stays
 * the named volume. (The app's own small settings volume always stays a named volume: its
 * ownership is set up for the app user automatically.)
 */
const DATA_FOLDERS = {
  "./volumes/db/data": { variable: "DB_DATA", volume: "db-data" },
  "./volumes/storage": { variable: "STORAGE_DATA", volume: "storage-data" },
  "./volumes/snippets": { variable: null, volume: "snippets" },
};

/** Compose interpolates `$` in every string of the file; a literal one is written `$$`. */
const escapeDollar = (text) => text.replaceAll("$", "$$$$");

/** Where the image's real entrypoint is, per service: what runs after the files are written. */
const AFTER_WRITE = {
  db: 'exec docker-entrypoint.sh "$@"',
  "api-gw": 'exec /bin/sh /supabase-entrypoint.sh "$@"',
};
/** The gateway's entrypoint script must not overwrite the image's own /docker-entrypoint.sh. */
const RENAMED_TARGET = { "/docker-entrypoint.sh": "/supabase-entrypoint.sh" };

/** One shell script that writes the files (heredocs, no expansion) and then starts the program. */
function startScript(files, after) {
  let script = "set -e\n";
  files.forEach(({ target, content }, i) => {
    const marker = `SHO_ERP_EOF_${i + 1}`;
    if (content.split("\n").includes(marker)) throw new Error(`${marker} occurs in ${target}`);
    const body = content.endsWith("\n") ? content : `${content}\n`;
    script += `mkdir -p ${path.posix.dirname(target)}\ncat > ${target} <<'${marker}'\n${body}${marker}\nchmod 0644 ${target}\n`;
  });
  return escapeDollar(`${script}${after}\n`);
}

/** What the Supabase-only stack calls its Docker network and the database's name on it. */
export const BACKEND_NETWORK = "${SUPABASE_NETWORK:-sho-supabase}";
export const BACKEND_DB_ALIAS = `${BACKEND_NETWORK}-db`;
/** Published database port (publishDb only): off the usual 5432/5433 that servers already use. */
export const BACKEND_DB_PORT = "${DB_BIND:-127.0.0.1}:${DB_PORT:-55432}:${POSTGRES_PORT}";

/**
 * `backendOnly` builds the stack without the app: just the Supabase containers it needs
 * (database, auth, rest, realtime, storage and the gateway). The stack's own Docker network
 * gets a fixed name (SUPABASE_NETWORK) and the database a unique name on it, so an app can
 * join that network and reach the database without any published port. `publishDb` also
 * publishes the database port, on DB_BIND (127.0.0.1 unless .env says otherwise), for an app
 * that cannot join the network.
 */
export function buildStandaloneCompose({ backendOnly = false, publishDb = false } = {}) {
  const compose = yaml.load(read("docker-compose.yml"));
  delete compose.name; // the stack gets the name its UI gives it
  if (backendOnly) {
    delete compose.services.app;
    delete compose.volumes?.["app-data"];
    compose.networks = { default: { name: BACKEND_NETWORK } };
    compose.services.db.networks = { default: { aliases: [BACKEND_DB_ALIAS] } };
    if (publishDb) compose.services.db.ports = [BACKEND_DB_PORT];
  }
  // A fixed container name would stop a second installation on the same server from starting.
  for (const service of Object.values(compose.services)) delete service.container_name;

  for (const [serviceName, service] of Object.entries(compose.services)) {
    if (!Array.isArray(service.volumes)) continue;
    const volumes = [];
    const files = [];
    for (const entry of service.volumes) {
      const [source, target] = String(entry).split(":");
      if (CONFIG_FILES.includes(source)) {
        files.push({ target: RENAMED_TARGET[target] ?? target, content: read(source.slice(2)) });
      } else if (DATA_FOLDERS[source]) {
        const { variable, volume } = DATA_FOLDERS[source];
        volumes.push(`${variable ? `\${${variable}:-${volume}}` : volume}:${target}`);
      } else {
        volumes.push(entry);
      }
    }
    if (files.length) {
      // `command` stays as it is: it becomes the arguments of the real entrypoint ("$@").
      service.entrypoint = ["/bin/sh", "-c", startScript(files, AFTER_WRITE[serviceName]), "--"];
    }
    if (volumes.length) service.volumes = volumes;
    else delete service.volumes;
  }

  compose.volumes = { ...(compose.volumes ?? {}) };
  for (const { volume } of Object.values(DATA_FOLDERS)) compose.volumes[volume] ??= null;

  const header = backendOnly
    ? `# Sho-ERP — Supabase only (generated by deploy/utils/build-standalone.mjs; do not edit).
#
# The services the app needs (database, auth, rest, realtime, storage and the API gateway)
# WITHOUT the app. Paste this file as the stack's compose, and the .env made by
# generator.html as its environment, then enter the connection details the generator shows
# in the app's /setup screen.
#
# The stack's Docker network is named by SUPABASE_NETWORK (sho-supabase by default; pick
# another name for a second stack on the same server) and the database is reachable on it
# as <that name>-db, port 5432. ${
        publishDb
          ? `The database port is ALSO published, on DB_BIND:DB_PORT
# (127.0.0.1:55432 unless .env says otherwise): open it to another address only on a
# network you trust.`
          : "No database port is published."
      }
#
# The configuration files are written by the containers' own start commands below and the
# data lives in named volumes (db-data, storage-data); set DB_DATA and STORAGE_DATA in .env
# to keep it in folders you choose instead.
`
    : `# Sho-ERP — single-file stack (generated by deploy/utils/build-standalone.mjs; do not edit).
#
# Paste this file as the stack's compose, and the .env made by generator.html as its
# environment. Needs Docker Compose v2. The configuration files are written by the
# containers' own start commands below and the data lives in named volumes (db-data,
# storage-data, app-data), so nothing else has to be uploaded. To keep the database and the
# files in a folder you choose instead, set DB_DATA and STORAGE_DATA in .env.
`;
  return header + yaml.dump(compose, { lineWidth: -1, noRefs: true });
}

/**
 * What the repository's docker-compose.yml (the app alone, at the repository root) says about
 * the app. The generator builds the app's compose file from it, adding only what depends on
 * the user (image, name, port, data folder, networks, setup token).
 */
export function readAppBase() {
  const rootCompose = yaml.load(readFileSync(path.join(root, "..", "docker-compose.yml"), "utf8"));
  const app = rootCompose.services.app;
  return { restart: app.restart, environment: app.environment };
}

export function buildGeneratorHtml() {
  const compose = buildStandaloneCompose();
  const backendCompose = buildStandaloneCompose({ backendOnly: true });
  const backendDbPortCompose = buildStandaloneCompose({ backendOnly: true, publishDb: true });
  const envTemplate = read(".env.example");
  const core = read("utils/generator-core.js");
  const page = read("utils/generator.template.html");
  // `<` is escaped so the data can never close its own <script> element.
  const data = JSON.stringify({
    compose,
    backendCompose,
    backendDbPortCompose,
    envTemplate,
    appBase: readAppBase(),
  }).replaceAll("<", "\\u003c");
  return page
    .replace("/*__CORE__*/", () => core)
    .replace("/*__DATA__*/", () => `window.SHO_DATA = ${data};`);
}

const outputs = () => ({
  "standalone/compose.yaml": buildStandaloneCompose(),
  "standalone/supabase-only.compose.yaml": buildStandaloneCompose({ backendOnly: true }),
  "standalone/supabase-only-db-port.compose.yaml": buildStandaloneCompose({
    backendOnly: true,
    publishDb: true,
  }),
  "generator.html": buildGeneratorHtml(),
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = false;
  for (const [file, content] of Object.entries(outputs())) {
    const full = path.join(root, file);
    if (check) {
      if (!existsSync(full) || readFileSync(full, "utf8") !== content) {
        console.error(`out of date: deploy/${file} (run: node utils/build-standalone.mjs)`);
        stale = true;
      }
    } else {
      writeFileSync(full, content);
      console.log(`wrote deploy/${file}`);
    }
  }
  if (stale) process.exit(1);
}
