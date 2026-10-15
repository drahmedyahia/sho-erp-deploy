/*
 * Secret and .env generation shared by generator.html (browser) and its test (Node).
 * Everything runs locally: nothing is sent anywhere. Mirrors utils/generate-keys.sh.
 */
(function (root) {
  "use strict";

  function randomBytes(n) {
    var b = new Uint8Array(n);
    root.crypto.getRandomValues(b);
    return b;
  }
  function hex(n) {
    return Array.prototype.map
      .call(randomBytes(n), function (x) {
        return x.toString(16).padStart(2, "0");
      })
      .join("");
  }
  function base64(n) {
    return btoa(String.fromCharCode.apply(null, randomBytes(n)));
  }
  function b64url(bytes) {
    return btoa(String.fromCharCode.apply(null, bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  function utf8(s) {
    return new TextEncoder().encode(s);
  }

  /**
   * SHA-256 and HMAC-SHA-256 in plain JavaScript. The browser's own crypto.subtle is
   * missing on pages served over plain http (it needs a secure context), and this page
   * must keep working until the hosted copy has its certificate.
   */
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function sha256(data) {
    var h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
      0x5be0cd19,
    ]);
    var len = data.length;
    var padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[len] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor((len * 8) / 0x100000000));
    view.setUint32(padded.length - 4, (len * 8) >>> 0);
    var w = new Uint32Array(64);
    for (var off = 0; off < padded.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x = w[i - 15];
        var y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0],
        b = h[1],
        c = h[2],
        d = h[3],
        e = h[4],
        f = h[5],
        g = h[6],
        hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      h[0] += a;
      h[1] += b;
      h[2] += c;
      h[3] += d;
      h[4] += e;
      h[5] += f;
      h[6] += g;
      h[7] += hh;
    }
    var out = new Uint8Array(32);
    var ov = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) ov.setUint32(j * 4, h[j]);
    return out;
  }
  function hmacSha256(keyBytes, msgBytes) {
    var key = keyBytes.length > 64 ? sha256(keyBytes) : keyBytes;
    var ipad = new Uint8Array(64 + msgBytes.length);
    var opad = new Uint8Array(64 + 32);
    for (var i = 0; i < 64; i++) {
      var kb = i < key.length ? key[i] : 0;
      ipad[i] = kb ^ 0x36;
      opad[i] = kb ^ 0x5c;
    }
    ipad.set(msgBytes, 64);
    opad.set(sha256(ipad), 64);
    return sha256(opad);
  }
  async function hmac(secret, message) {
    var subtle = root.crypto && root.crypto.subtle;
    if (subtle) {
      var key = await subtle.importKey(
        "raw",
        utf8(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      return new Uint8Array(await subtle.sign("HMAC", key, utf8(message)));
    }
    return hmacSha256(utf8(secret), utf8(message));
  }

  /** HS256 JWT, the same shape generate-keys.sh produces (5 years). */
  async function signJwt(role, secret, nowSeconds) {
    var iat = nowSeconds || Math.floor(Date.now() / 1000);
    var exp = iat + 5 * 3600 * 24 * 365;
    var header = b64url(utf8('{"alg":"HS256","typ":"JWT"}'));
    var payload = b64url(
      utf8('{"role":"' + role + '","iss":"supabase","iat":' + iat + ',"exp":' + exp + "}"),
    );
    return header + "." + payload + "." + b64url(await hmac(secret, header + "." + payload));
  }

  async function makeSecrets() {
    var jwt = base64(30);
    return {
      JWT_SECRET: jwt,
      ANON_KEY: await signJwt("anon", jwt),
      SERVICE_ROLE_KEY: await signJwt("service_role", jwt),
      SECRET_KEY_BASE: base64(48),
      REALTIME_DB_ENC_KEY: hex(8),
      VAULT_ENC_KEY: hex(16),
      PG_META_CRYPTO_KEY: base64(24),
      LOGFLARE_PUBLIC_ACCESS_TOKEN: base64(24),
      LOGFLARE_PRIVATE_ACCESS_TOKEN: base64(24),
      S3_PROTOCOL_ACCESS_KEY_ID: hex(16),
      S3_PROTOCOL_ACCESS_KEY_SECRET: hex(32),
      MINIO_ROOT_PASSWORD: hex(16),
      POSTGRES_PASSWORD: hex(16),
      DASHBOARD_PASSWORD: hex(16),
    };
  }

  /**
   * Six hex characters that identify one Generate click: the start of the SHA-256 of the
   * JWT secret (a prefix of 24 bits says nothing useful about a 240-bit secret). It is shown on
   * the page and written on the first line of .env, so a file from another click is
   * recognised at a glance: every click makes new secrets, and the database keeps the ones
   * it was first started with.
   */
  function fingerprint(secrets) {
    return Array.prototype.map
      .call(sha256(utf8(secrets.JWT_SECRET)).subarray(0, 3), function (x) {
        return x.toString(16).padStart(2, "0");
      })
      .join("");
  }

  /** Trims, removes a trailing slash; returns "" when it is not an http(s) address. */
  function cleanUrl(value) {
    var v = String(value || "")
      .trim()
      .replace(/\/+$/, "");
    return /^https?:\/\/[^\s/]+(:\d+)?$/.test(v) ? v : "";
  }

  /** A plain absolute POSIX folder, or "" (colons, spaces and `$` would break the mount line). */
  function cleanDataDir(value) {
    var v = String(value || "")
      .trim()
      .replace(/\/+$/, "");
    var plain = /^\/[A-Za-z0-9._@+\-]+(\/[A-Za-z0-9._@+\-]+)*$/.test(v);
    return plain && !/(^|\/)\.{1,2}(\/|$)/.test(v) ? v : "";
  }

  function cleanPort(value, fallback) {
    var n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? String(n) : String(fallback);
  }

  /**
   * Fills the .env template (the text of .env.example). `options`:
   * appUrl, apiUrl (validated), appPort, apiPort, image, adminEmail.
   */
  function buildEnv(template, options, secrets) {
    var values = Object.assign({}, secrets, {
      SUPABASE_PUBLIC_URL: options.apiUrl,
      API_EXTERNAL_URL: options.apiUrl + "/auth/v1",
      SITE_URL: options.appUrl,
      APP_PORT: options.appPort,
      API_GW_HTTP_PORT: options.apiPort,
      DISABLE_SIGNUP: "true",
    });
    if (options.image) values.APP_IMAGE = options.image;
    if (options.adminEmail) values.BOOTSTRAP_ADMIN_EMAIL = options.adminEmail;
    var lines = template.replace(/\n+$/, "").split("\n");
    if (options.project) {
      // The Compose project name: the prefix of the container and volume names. Dockge and
      // Portainer use the name given to the stack there instead; the terminal uses this one.
      lines.push("", "# Project (stack) name", "COMPOSE_PROJECT_NAME=" + options.project);
    }
    if (options.network) {
      // Supabase-only stack: its Docker network, and where the database port is published.
      lines.push("", "# Supabase-only stack", "SUPABASE_NETWORK=" + options.network);
      if (options.dbBind) lines.push("DB_BIND=" + options.dbBind, "DB_PORT=" + options.dbPort);
    }
    if (options.dataDir) {
      lines.push(
        "",
        "# Data folders chosen in the generator (unset = Docker-managed named volumes)",
        "DB_DATA=" + options.dataDir + "/db",
        "STORAGE_DATA=" + options.dataDir + "/storage",
      );
    }
    lines.unshift(
      "# Generated by the Sho-ERP generator. Fingerprint: " +
        fingerprint(secrets) +
        " (the page shows the same code; if it differs, this file is from another Generate click).",
    );
    var out = lines.map(function (line) {
      var m = /^([A-Z0-9_]+)=/.exec(line);
      return m && Object.prototype.hasOwnProperty.call(values, m[1])
        ? m[1] + "=" + values[m[1]]
        : line;
    });
    return out.join("\n") + "\n";
  }

  /** A plain IPv4 address (the address the database port is published on), or "". */
  function cleanBind(value) {
    var v = String(value || "").trim();
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
    if (!m) return "";
    return m.slice(1).every(function (o) {
      return Number(o) <= 255 && String(Number(o)) === o;
    })
      ? v
      : "";
  }

  /** The guard of the app's /setup screen: 24 hex characters, made with the other secrets. */
  function makeSetupToken() {
    return hex(12);
  }

  var APP_IMAGE_REPO = "ghcr.io/drahmedyahia/sho-erp-release";
  var DEFAULT_APP_IMAGE = APP_IMAGE_REPO + ":latest";

  /** A Docker image tag: letters, digits, _ . - (not starting with . or -), at most 128 characters. */
  function cleanImageTag(value) {
    var v = String(value || "").trim();
    return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(v) ? v : "";
  }

  /**
   * The app image from what the page asks: a full image address wins; otherwise a version tag
   * of the official image (v1.0.0 -> ghcr.io/drahmedyahia/sho-erp-release:v1.0.0); both empty =
   * "" (the default, :latest). Returns { image } or { error: "tag" }.
   */
  function resolveImage(image, tag) {
    var full = String(image || "").trim();
    if (full) return { image: full };
    var raw = String(tag || "").trim();
    if (!raw) return { image: "" };
    var clean = cleanImageTag(raw);
    return clean ? { image: APP_IMAGE_REPO + ":" + clean } : { error: "tag" };
  }
  /** The public repository that holds the deploy folder as its root (nothing else of the project). */
  var DEFAULT_DEPLOY_REPO = "https://github.com/drahmedyahia/sho-erp-deploy.git";

  /** A YAML scalar: plain when it is safe as one, otherwise a double-quoted string. */
  function yamlValue(value) {
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    var text = String(value);
    // Not plain when YAML would read it as a number (1e5, .5, .inf) rather than as text.
    var plain =
      /^[A-Za-z0-9_.\/:@+-]+$/.test(text) &&
      !/^[0-9eE.+-]+$/.test(text) &&
      !/^[+-]?\.?(inf|nan)$/i.test(text);
    var reserved = /^(true|false|null|yes|no|on|off|y|n)$/i.test(text);
    return plain && !reserved ? text : JSON.stringify(text);
  }

  /**
   * The compose file of the app alone (Supabase-only way, compose tools), written from `base`:
   * what the repository's own docker-compose.yml says about the app (`restart` and `environment`,
   * embedded in the page when it is built). `o`: image, container, port, dataDir ("" = a named
   * volume), proxy (the reverse proxy's network, or ""), join (also join the Supabase stack's
   * network), network (its name), internal (add SUPABASE_INTERNAL_URL), token (SETUP_TOKEN).
   */
  function buildAppCompose(base, o) {
    var env = Object.assign({}, base.environment, { SETUP_TOKEN: o.token });
    var lines = [
      "# Sho-ERP app. Made by the generator from the repository's docker-compose.yml.",
      "# Create it as its own project, then open <your app address>/setup: enter the SETUP_TOKEN below",
      "# and the connection details of your Supabase. When the setup is done, empty SETUP_TOKEN and",
      "# deploy once more (an empty token disables the screen).",
      "services:",
      "  app:",
      "    image: " + yamlValue(o.image || DEFAULT_APP_IMAGE),
      "    container_name: " + yamlValue(o.container),
      "    restart: " + yamlValue(base.restart || "unless-stopped"),
      "    environment:",
    ];
    Object.keys(env).forEach(function (key) {
      // The token is always quoted: made only of digits and an "e" it would be read as a number.
      lines.push(
        "      " +
          key +
          ": " +
          (key === "SETUP_TOKEN" ? JSON.stringify(env[key]) : yamlValue(env[key])),
      );
    });
    if (o.internal) {
      lines.push(
        "      # Optional: the app's own server-side calls to Supabase stay inside the Supabase network.",
        "      SUPABASE_INTERNAL_URL: http://api-gw:8000",
      );
    }
    lines.push(
      "    volumes:",
      "      - " + yamlValue((o.dataDir || "app-data") + ":/app/data"),
      "    ports:",
      "      - " + JSON.stringify(o.port + ":3000"), // quoted, as Compose advises for ports
    );
    var networks = [];
    if (o.proxy) networks.push(o.proxy);
    else if (o.join) networks.push("default");
    if (o.join) networks.push("supabase");
    if (networks.length) {
      lines.push("    networks:");
      networks.forEach(function (name) {
        lines.push("      - " + name);
      });
    }
    if (!o.dataDir) lines.push("volumes:", "  app-data: {}");
    if (o.proxy || o.join) {
      lines.push("networks:");
      if (o.proxy) lines.push("  " + o.proxy + ":", "    external: true");
      if (o.join) lines.push("  supabase:", "    external: true", "    name: " + o.network);
    }
    return lines.join("\n") + "\n";
  }

  /** A DNS name or IPv4 address (not 0.0.0.0) the app reaches the server by, or "". */
  function cleanHost(value) {
    var v = String(value || "")
      .trim()
      .toLowerCase();
    if (cleanBind(v)) return v === "0.0.0.0" ? "" : v;
    if (/^[0-9.]+$/.test(v)) return "";
    var label = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
    return new RegExp("^" + label + "(\\." + label + ")*$").test(v) && v.length <= 253 ? v : "";
  }

  /** A Compose project (stack) name: lower-case letters, digits, - and _, starting with a letter or digit. */
  function cleanProjectName(value) {
    var v = String(value || "").trim();
    return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(v) ? v : "";
  }

  /** An SSH or registry user name: letters, digits and . _ - (no spaces or quotes), or "". */
  function cleanUserName(value) {
    var v = String(value || "").trim();
    return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(v) ? v : "";
  }

  /** The address of a Git repository (https or ssh form) with no spaces or quotes, or "". */
  function cleanRepoUrl(value) {
    var v = String(value || "").trim();
    var https = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9_.~+\/-]+$/;
    var ssh = /^git@[A-Za-z0-9.-]+:[A-Za-z0-9_.~+\/-]+$/;
    return https.test(v) || ssh.test(v) ? v : "";
  }

  /**
   * The commands that bring the deploy folder to the server, before install.sh. `o`: sshUser,
   * sshHost, sshPort (may be ""), dir (the project folder on the server), repo, registryUser.
   * What is empty stays a <placeholder> to fill in. Every value is validated by the caller, so
   * the commands can be pasted as they are.
   */
  function sshFetchCommands(o) {
    var user = o.sshUser || "<user>";
    var host = o.sshHost || "<server>";
    var dir = o.dir || "/opt/sho-erp";
    var repo = o.repo || DEFAULT_DEPLOY_REPO;
    var ssh = "ssh" + (o.sshPort ? " -p " + o.sshPort : "") + " " + user + "@" + host;
    var scp = "scp" + (o.sshPort ? " -P " + o.sshPort : "") + " -r deploy " + user + "@" + host;
    return {
      // From your computer: make the folder, then copy deploy into it (dir/deploy).
      scp: ssh + ' "mkdir -p ' + dir + '"\n' + scp + ":" + dir + "/",
      // On the server: the public deploy repository IS the deploy folder, so it goes into dir/deploy.
      git: "git clone --depth 1 " + repo + " " + dir + "/deploy",
      login: "sudo docker login ghcr.io -u " + (o.registryUser || "<user name>"),
      cd: "cd " + dir + "/deploy",
    };
  }

  /** A Docker network name: lower case letters, digits, . _ - (starts with a letter or digit). */
  function cleanNetworkName(value) {
    var v = String(value || "").trim();
    return /^[a-z0-9][a-z0-9_.-]{0,62}$/.test(v) ? v : "";
  }

  var DEFAULT_NETWORK = "sho-supabase";
  var DEFAULT_DB_PORT = "55432";
  var DEFAULT_BRIDGE = "172.17.0.1";

  /**
   * Where the app runs, for the Supabase-only stack -> what goes into .env and into the
   * database URL. `where`:
   *   network  the app is a container on this server and joins the stack's network
   *            (no database port is published; the URL uses <network>-db:5432)
   *   bridge   a container on this server, reaching a port published on the address of
   *            its Docker network's gateway (172.17.0.1 for the default network)
   *   local    a program on this server outside Docker, or an SSH tunnel (127.0.0.1)
   *   remote   another machine: published on every address, the URL uses the server's address
   * Returns { error } ("network" | "bind" | "server") or { network, dbBind, dbPort, host, port }
   * (dbBind and dbPort are "" when nothing is published).
   */
  function planBackend(options) {
    var network = cleanNetworkName(options.network || DEFAULT_NETWORK);
    if (!network) return { error: "network" };
    var where = options.where || "network";
    if (where === "network") {
      return { network: network, dbBind: "", dbPort: "", host: network + "-db", port: "5432" };
    }
    var port = cleanPort(options.dbPort, DEFAULT_DB_PORT);
    if (where === "remote") {
      var host = cleanHost(options.serverAddr);
      if (!host) return { error: "server" };
      return { network: network, dbBind: "0.0.0.0", dbPort: port, host: host, port: port };
    }
    var bind = cleanBind(options.dbBind || (where === "bridge" ? DEFAULT_BRIDGE : "127.0.0.1"));
    if (!bind || bind === "0.0.0.0") return { error: "bind" };
    return { network: network, dbBind: bind, dbPort: port, host: bind, port: port };
  }

  /**
   * What the app's /setup screen asks for when its Supabase runs elsewhere: the direct
   * database URL, the project (API gateway) URL and the two keys. `values.DB_HOST` and
   * `values.DB_PORT` are where the app reaches the database (see planBackend).
   */
  function connectionDetails(values) {
    return {
      databaseUrl:
        "postgresql://postgres:" +
        values.POSTGRES_PASSWORD +
        "@" +
        values.DB_HOST +
        ":" +
        values.DB_PORT +
        "/postgres",
      projectUrl: values.SUPABASE_PUBLIC_URL,
      anonKey: values.ANON_KEY,
      serviceRoleKey: values.SERVICE_ROLE_KEY,
    };
  }

  /**
   * The `sh install.sh ...` command that makes the same installation from a terminal (the
   * script makes its own secrets). `o`: mode ("full" | "backend"), apiUrl, appUrl, plan (planBackend).
   */
  function sshCommand(o) {
    var project = o.project ? " --project " + o.project : "";
    var tag = o.imageTag ? " --image-tag " + o.imageTag : "";
    if (o.mode !== "backend")
      return "sh install.sh" + project + tag + " " + o.apiUrl + " " + o.appUrl;
    var p = o.plan;
    var parts = ["sh install.sh --supabase-only" + project];
    if (p.network !== DEFAULT_NETWORK) parts.push("--network " + p.network);
    if (p.dbBind) {
      parts.push("--db-bind " + p.dbBind);
      if (p.dbPort !== DEFAULT_DB_PORT) parts.push("--db-port " + p.dbPort);
      if (p.dbBind === "0.0.0.0") parts.push("--db-host " + p.host);
    }
    parts.push(o.apiUrl);
    return parts.join(" ");
  }

  /** The part to add to the app's own compose file so it joins the stack's network. */
  function appSnippet(network) {
    return [
      "# In the app's compose.yaml, under the app service (keep the networks it already has,",
      "# for example the reverse proxy's):",
      "services:",
      "  your-app-service:",
      "    networks:",
      "      - default",
      "      - supabase",
      "    environment:",
      "      # Optional, recommended (harmless if not needed): the app's own server-side calls to Supabase stay inside this network, not out to the internet and back.",
      "      SUPABASE_INTERNAL_URL: http://api-gw:8000",
      "",
      "# and at the end of the file:",
      "networks:",
      "  supabase:",
      "    external: true",
      "    name: " + network,
      "",
    ].join("\n");
  }

  var api = {
    fingerprint: fingerprint,
    cleanBind: cleanBind,
    cleanHost: cleanHost,
    cleanNetworkName: cleanNetworkName,
    cleanProjectName: cleanProjectName,
    cleanUserName: cleanUserName,
    cleanRepoUrl: cleanRepoUrl,
    sshFetchCommands: sshFetchCommands,
    DEFAULT_DEPLOY_REPO: DEFAULT_DEPLOY_REPO,
    planBackend: planBackend,
    appSnippet: appSnippet,
    sshCommand: sshCommand,
    connectionDetails: connectionDetails,
    makeSecrets: makeSecrets,
    makeSetupToken: makeSetupToken,
    buildAppCompose: buildAppCompose,
    DEFAULT_APP_IMAGE: DEFAULT_APP_IMAGE,
    resolveImage: resolveImage,
    cleanImageTag: cleanImageTag,
    buildEnv: buildEnv,
    cleanUrl: cleanUrl,
    cleanPort: cleanPort,
    cleanDataDir: cleanDataDir,
    signJwt: signJwt,
    hmacSha256: hmacSha256,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ShoGenerator = api;
})(typeof window !== "undefined" ? window : globalThis);
