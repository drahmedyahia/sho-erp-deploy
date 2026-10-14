// Writes a complete .env to stdout, with freshly generated secrets, using the SAME code as
// generator.html (utils/generator-core.js). Used by CI to install the way a user does.
//
//   node utils/make-env.mjs <app url> <api url> [app port] [gateway port] [app image] > .env
//
// Supabase-only stack (no app): add the flags the generator's questions map to.
//
//   --where network|bridge|local|remote   where the app runs (default network)
//   --network NAME      the stack's Docker network name (default sho-supabase)
//   --db-bind ADDRESS   address the database port is published on (bridge, local)
//   --db-port PORT      published database port (default 55432)
//   --server ADDRESS    the server's address as the app reaches it (remote)
//   --project NAME      the Compose project (stack) name, written as COMPOSE_PROJECT_NAME
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
await import("./generator-core.js");
const G = globalThis.ShoGenerator;

const positional = [];
const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i] ?? "";
  else positional.push(argv[i]);
}

const [appArg, apiArg, appPort = "3000", apiPort = "8000", image = ""] = positional;
const appUrl = G.cleanUrl(appArg);
const apiUrl = G.cleanUrl(apiArg);
if (!appUrl || !apiUrl || appUrl === apiUrl) {
  console.error(
    "usage: node make-env.mjs <app url> <api url> [app port] [gateway port] [app image]" +
      " [--where network|bridge|local|remote] [--network NAME] [--db-bind ADDRESS]" +
      " [--db-port PORT] [--server ADDRESS]",
  );
  process.exit(2);
}

const project = flags.project ? G.cleanProjectName(flags.project) : "";
if (flags.project && !project) {
  console.error("invalid --project");
  process.exit(2);
}
let plan = {};
if (["where", "network", "db-bind", "db-port", "server"].some((k) => k in flags)) {
  plan = G.planBackend({
    where: flags.where,
    network: flags.network,
    dbBind: flags["db-bind"],
    dbPort: flags["db-port"],
    serverAddr: flags.server,
  });
  if (plan.error) {
    console.error(
      `invalid --${plan.error === "server" ? "server" : plan.error === "bind" ? "db-bind" : "network"}`,
    );
    process.exit(2);
  }
}

const template = readFileSync(path.join(here, "..", ".env.example"), "utf8");
process.stdout.write(
  G.buildEnv(
    template,
    {
      appUrl,
      apiUrl,
      appPort: G.cleanPort(appPort, 3000),
      apiPort: G.cleanPort(apiPort, 8000),
      image: image.trim(),
      adminEmail: "",
      project,
      network: plan.network,
      dbBind: plan.dbBind,
      dbPort: plan.dbPort,
    },
    await G.makeSecrets(),
  ),
);
