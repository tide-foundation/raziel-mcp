// The scaffold and the doctor: a new app starts from a template that works, and one command says
// what is wrong with an app. Both are only worth having if the templates really are sound and the
// doctor really catches the faults it claims to, so this runs them.
import { mkClient, callTool, Checks, PACK_ROOT, packRead, listDir } from "./harness.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DOCTOR = join(PACK_ROOT, "templates/shared/tide-doctor.sh");
const ADAPTER = {
  realm: "demo", "auth-server-url": "http://localhost:8080", "ssl-required": "external", resource: "demo-client",
  "public-client": true, "confidential-port": 0, vendorId: "v", homeOrkUrl: "https://ork1.tideprotocol.com",
  jwk: { keys: [{ kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", kid: "k", alg: "EdDSA", use: "sig" }] },
  "client-origin-auth-http://localhost:3000": "sig",
};

// spawnSync would block the event loop and starve the in-process mock servers below.
function run(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn("bash", [DOCTOR, ...args], { env: { PATH: process.env.PATH, HOME: tmpdir(), ...env } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill(), 30000);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
// A fresh copy of a template, exactly as tide_scaffold's `cp -R <template>/. <dir>/` makes it,
// plus the adapter the bootstrap would have written.
function scaffold(name, adapterPath) {
  const dir = mkdtempSync(join(tmpdir(), "tide-scaf-"));
  cpSync(join(PACK_ROOT, "templates", name), dir, { recursive: true, filter: (s) => !/node_modules|\/\.next|\/dist$/.test(s) });
  mkdirSync(join(dir, adapterPath, ".."), { recursive: true });
  writeFileSync(join(dir, adapterPath), JSON.stringify(ADAPTER));
  return dir;
}
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, "utf8")));
const listen = (handler) => new Promise((res) => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });

export async function run_() {
  const c = new Checks("scaffold");
  if (process.platform === "win32") return c.results;

  // --- The templates themselves -------------------------------------------------------------
  // MEASURED 2026-10-07 by building them: the portal had no tsconfig.json, so its `@/` imports
  // could not resolve, and the Vite template imported a name @tidecloak/react has never exported.
  // Neither built. A scaffold is only as good as what it copies.
  for (const t of ["nextjs-customer-portal", "nextjs-e2ee-vault"]) {
    const ts = packRead(`templates/${t}/tsconfig.json`) || "";
    c.ok(`${t} has a tsconfig.json mapping @/* to src (its imports depend on it)`, /"@\/\*"/.test(ts) && /\.\/src\/\*/.test(ts));
    // The proof verifier must be the pack's tested one, byte for byte, and must actually be called.
    c.ok(`${t} ships the tested DPoP verifier unchanged`,
      packRead(`templates/${t}/src/lib/auth/verifyDpop.ts`) === packRead("templates/dpop-verify/verifyDpop.ts"));
    const guard = (packRead(`templates/${t}/src/lib/auth/protect.ts`) ?? "") + (packRead(`templates/${t}/src/lib/auth/middleware.ts`) ?? "");
    c.ok(`${t} verifies the DPoP proof in withAuth, after the JWT`,
      /await verifyDpop\(req, token/.test(guard) && guard.indexOf("verifyTideJWT(token)") < guard.indexOf("await verifyDpop("),
      "a bound token replayed as a plain Bearer would pass (AP-43)");
  }
  const vite = packRead("templates/react-vite-internal-dashboard/src/main.tsx") || "";
  c.ok("the Vite template imports TideCloakContextProvider (TideCloakProvider is not in @tidecloak/react)",
    /import \{[^}]*TideCloakContextProvider[^}]*\} from "@tidecloak\/react"/.test(vite) && !/\bTideCloakProvider\b/.test(vite));

  // --- tide_scaffold --------------------------------------------------------------------------
  const client = await mkClient();
  let r = await callTool(client, "tide_scaffold", { situation: "add login to a new Next.js app", appName: "Mood Garden" });
  c.ok("scaffold picks the portal for a plain new app and leads with the licence ask",
    !r.isError && r.text.includes("# Scaffold: `nextjs-customer-portal`") && r.text.indexOf("BEFORE ANY TIDE REALM IS SET UP") < 20);
  c.ok("scaffold gives a copy command for this machine, including dotfiles",
    r.text.includes(`cp -R "${PACK_ROOT}/templates/nextjs-customer-portal/." "./"`));
  c.ok("scaffold derives a valid package name", r.text.includes("`mood-garden`") && r.text.includes("`mood-garden-client`"));
  c.ok("scaffold writes out the .gitignore and names the three .env values",
    /```gitignore[\s\S]*\r?\n\.env\r?\n/.test(r.text) && r.text.includes("TIDE_LICENSE_EMAIL") && r.text.includes("TIDE_TERMS_ACCEPTED=yes") && r.text.includes("KC_BOOTSTRAP_ADMIN_PASSWORD"));
  c.ok("scaffold ends with the doctor, static then --url", r.text.includes("tide-doctor.sh\"\n") && r.text.includes("tide-doctor.sh\" --url http://localhost:3000"));
  const picks = [
    ["an encrypted notes app", "nextjs-e2ee-vault"], ["a React Vite dashboard", "react-vite-internal-dashboard"],
    ["a plain html form, no framework", "vanilla-js-secure-form"], ["a Next.js app with a vault", "nextjs-e2ee-vault"],
    ["a customer portal", "nextjs-customer-portal"],
  ];
  for (const [situation, want] of picks) {
    r = await callTool(client, "tide_scaffold", { situation });
    c.ok(`scaffold picks ${want} for "${situation}"`, r.text.includes(`# Scaffold: \`${want}\``), r.text.slice(0, 80));
  }
  for (const t of listDir("templates").filter((d) => /^(nextjs|react-vite|vanilla)/.test(d))) {
    r = await callTool(client, "tide_scaffold", { template: t });
    c.ok(`scaffold(${t}) lists the template's own files and says whether it has a server`,
      !r.isError && r.text.includes("public/tide_dpop_auth.html") && /Has a server|CLIENT ONLY/.test(r.text));
  }
  r = await callTool(client, "tide_scaffold", { template: "react-vite-internal-dashboard" });
  c.ok("a client-only template says it cannot protect an API, and bootstraps with the shared script",
    /CLIENT ONLY\. It cannot protect an API/.test(r.text) && r.text.includes("ADAPTER_OUTPUT=public/tidecloak.json") && r.text.includes("bootstrap-tidecloak.sh"));
  const hosted = await mkClient({ publicBaseUrl: "https://mcp.example.test", packArchive: true });
  for (const [tool, args] of [["tide_scaffold", { situation: "new app" }], ["tide_doctor", {}]]) {
    const h = await callTool(hosted, tool, args);
    c.ok(`hosted ${tool} uses the fetched pack, never a path on the server`,
      !h.isError && !h.text.includes(PACK_ROOT) && h.text.includes(".tide-pack/templates/") && h.text.includes("/pack/templates.tgz"), h.text.slice(0, 120));
  }
  await hosted.close();
  r = await callTool(client, "tide_doctor", { appUrl: "http://localhost:3000", realm: "demo" });
  c.ok("tide_doctor returns a runnable command with the flags asked for",
    !r.isError && r.text.includes(`bash "${PACK_ROOT}/templates/shared/tide-doctor.sh" --url http://localhost:3000 --realm demo`));
  c.ok("tide_doctor says it repairs, and that what is left is the agent's job, not the user's",
    /It repairs what it can/.test(r.text) && /Apply the fix yourself/.test(r.text) && /do not hand the list to the user/.test(r.text));
  r = await callTool(client, "tide_doctor", { checkOnly: true });
  c.ok("tide_doctor checkOnly adds --check", r.text.includes("tide-doctor.sh\" --check"));
  r = await callTool(client, "tide_choose_playbook", { situation: "add login to a new Next.js app" });
  c.ok("the work order sends a new build to tide_scaffold and ends with tide_doctor",
    /Start from a working template — call `tide_scaffold`/.test(r.text) && /call `tide_doctor`/.test(r.text) &&
    r.text.indexOf("tide_scaffold") < r.text.indexOf("tide_doctor"));
  r = await callTool(client, "tide_choose_playbook", { situation: "login popup is blank" });
  c.ok("a diagnosis is sent to tide_doctor first", /Call `tide_doctor` first/.test(r.text));
  await client.close();

  // --- tide-doctor.sh: healthy apps pass ------------------------------------------------------
  const healthy = [["nextjs-customer-portal", "data/tidecloak.json"], ["nextjs-e2ee-vault", "data/tidecloak.json"],
    ["react-vite-internal-dashboard", "public/tidecloak.json"], ["vanilla-js-secure-form", "public/tidecloak.json"]];
  for (const [t, a] of healthy) {
    const dir = scaffold(t, a);
    const res = await run(["--app", dir]);
    c.ok(`doctor: a freshly scaffolded ${t} has no failures and no warnings`,
      res.code === 0 && /RESULT: OK/.test(res.out) && !/^\s+(FAIL|WARN)/m.test(res.out), res.out.split("\n").filter((l) => /FAIL|WARN/.test(l)).join(" | "));
    rmSync(dir, { recursive: true, force: true });
  }

  // --- tide-doctor.sh: each fault is caught ---------------------------------------------------
  const faults = [
    ["useDPoP passed as a JSX prop", (d) => edit(join(d, "src/app/providers.tsx"), (s) => s.replace(/config=\{\{[^\n]*\}\}/, 'config={tcConfig} useDPoP={{ mode: "strict" }}')), /passed as a JSX PROP/],
    ["useDPoP missing altogether", (d) => edit(join(d, "src/app/providers.tsx"), (s) => s.replace(/config=\{\{[^\n]*\}\}/, "config={tcConfig}").replace(/useDPoP/g, "dpop")), /WARN\s+useDPoP is not set anywhere/, 0],
    ["a proxy given only the adapter", (d) => writeFileSync(join(d, "proxy.ts"), "import { createTideCloakProxy } from '@tidecloak/nextjs/server';\nimport tcConfig from './data/tidecloak.json';\nexport default createTideCloakProxy(tcConfig);\n"), /called with the adapter directly/],
    ["a proxy with no protectedRoutes", (d) => writeFileSync(join(d, "proxy.ts"), "import { createTideCloakProxy } from '@tidecloak/nextjs/server';\nexport const proxy = createTideCloakProxy({\n  config: cfg,\n});\n"), /declares no protectedRoutes/],
    ["frame-ancestors", (d) => edit(join(d, "next.config.ts"), (s) => s.replace("frame-src 'self' *", "frame-src 'self' *; frame-ancestors 'self'")), /sets frame-ancestors/],
    ["an adapter without its key", (d) => edit(join(d, "data/tidecloak.json"), (s) => { const j = JSON.parse(s); delete j.jwk; return JSON.stringify(j); }), /adapter has no "jwk"/],
    ["no adapter at all", (d) => rmSync(join(d, "data/tidecloak.json")), /no adapter JSON found/],
    ["a remote JWKS", (d) => edit(join(d, "src/lib/auth/tideJWT.ts"), (s) => s.replace("createLocalJWKSet(_config.jwk)", 'createRemoteJWKSet(new URL("https://x/certs"))')), /createRemoteJWKSet is used/],
    ["no proof verification", (d) => { edit(join(d, "src/lib/auth/protect.ts"), (s) => s.replace(/\n.*verifyDpop.*/g, "").replace(/\(AP-43\)[^\n]*/g, "").replace(/cnf/g, "c_f")); rmSync(join(d, "src/lib/auth/verifyDpop.ts")); }, /WARN\s+DPoP is on, but no server code checks the proof/, 0],
    ["a password written into a script", (d) => { mkdirSync(join(d, "ops"), { recursive: true }); writeFileSync(join(d, "ops/run.sh"), "KC_BOOTSTRAP_ADMIN_PASSWORD=hunter2 docker run x\n"); }, /master-admin password is written into a file/],
  ];
  for (const [label, breakIt, expect, wantCode = 1] of faults) {
    const dir = scaffold("nextjs-customer-portal", "data/tidecloak.json");
    breakIt(dir);
    const res = await run(["--app", dir]);
    c.ok(`doctor catches ${label}`, res.code === wantCode && expect.test(res.out) && /fix: /.test(res.out),
      `exit=${res.code} ` + res.out.split("\n").filter((l) => /FAIL|WARN/.test(l)).join(" | ").slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
  }

  // --- tide-doctor.sh repairs what has exactly one correct repair ------------------------------
  // "Should fix itself, not ask the user to fix" (user, 2026-10-07). A fault with a single mechanical
  // repair is repaired and re-checked. Anything needing a decision is left as FAIL for the agent.
  const GOOD = "9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757";
  const sha = async (f) => {
    try { return (await import("node:crypto")).createHash("sha256").update(readFileSync(f)).digest("hex"); } catch { return ""; }
  };
  const repairs = [
    ["the stale DPoP page", (d) => edit(join(d, "public/tide_dpop_auth.html"), (s) => s.replace(/window\.opener \|\| window\.parent/g, "window.parent").replace(/window\.opener/g, "window.parent")),
      /STALE page/, /FIXED public\/tide_dpop_auth\.html was the STALE page/, async (d) => (await sha(join(d, "public/tide_dpop_auth.html"))) === GOOD],
    ["a missing DPoP page", (d) => rmSync(join(d, "public/tide_dpop_auth.html")),
      /no tide_dpop_auth\.html in public/, /FIXED public\/tide_dpop_auth\.html was missing/, async (d) => (await sha(join(d, "public/tide_dpop_auth.html"))) === GOOD],
    ["an exact-path rewrite", (d) => edit(join(d, "next.config.ts"), (s) => s.replace(/source: "\/tide_dpop\/:path\*"/g, 'source: "/tide_dpop"')),
      /rewrites the exact path \/tide_dpop/, /FIXED next\.config\.ts matched the exact path/, async (d) => !/source: "\/tide_dpop"/.test(readFileSync(join(d, "next.config.ts"), "utf8")) && /tide_dpop\/:path\*/.test(readFileSync(join(d, "next.config.ts"), "utf8"))],
    ["an un-ignored .env", (d) => { writeFileSync(join(d, ".env"), "KC_BOOTSTRAP_ADMIN_PASSWORD=x\n"); writeFileSync(join(d, ".gitignore"), "node_modules/\n"); },
      /\.env exists and is NOT gitignored/, /FIXED \.env was not gitignored/, async (d) => /^\.env$/m.test(readFileSync(join(d, ".gitignore"), "utf8"))],
  ];
  for (const [label, breakIt, failRe, fixedRe, repaired] of repairs) {
    let dir = scaffold("nextjs-customer-portal", "data/tidecloak.json");
    breakIt(dir);
    const before = readFileSync(join(dir, "next.config.ts"), "utf8");
    let res = await run(["--app", dir, "--check"]);
    c.ok(`doctor --check reports ${label} and changes nothing`,
      res.code === 1 && failRe.test(res.out) && !/FIXED/.test(res.out) && !(await repaired(dir)) && readFileSync(join(dir, "next.config.ts"), "utf8") === before,
      `exit=${res.code}`);
    res = await run(["--app", dir]);
    const ok = await repaired(dir);
    const again = await run(["--app", dir]);
    c.ok(`doctor repairs ${label}, and the next run is clean`,
      res.code === 0 && fixedRe.test(res.out) && ok && again.code === 0 && !/FIXED|FAIL/.test(again.out),
      `exit=${res.code} repaired=${ok} ` + res.out.split("\n").filter((l) => /FAIL|FIXED/.test(l)).join(" | ").slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
  }
  // A decision is never made for the user: the proxy fault is left alone even in repair mode.
  {
    const dir = scaffold("nextjs-customer-portal", "data/tidecloak.json");
    const proxySrc = "import { createTideCloakProxy } from '@tidecloak/nextjs/server';\nexport default createTideCloakProxy(tcConfig);\n";
    writeFileSync(join(dir, "proxy.ts"), proxySrc);
    const res = await run(["--app", dir]);
    c.ok("doctor does NOT rewrite route protection (which routes need which roles is a decision)",
      res.code === 1 && /called with the adapter directly/.test(res.out) && readFileSync(join(dir, "proxy.ts"), "utf8") === proxySrc && /do it yourself/.test(res.out));
    rmSync(dir, { recursive: true, force: true });
  }

  // --- tide-doctor.sh --url: what is actually served ------------------------------------------
  const page = readFileSync(join(PACK_ROOT, "templates/nextjs-customer-portal/public/tide_dpop_auth.html"));
  const hex = (s) => Buffer.from(s).toString("hex");
  const relay = `/tide_dpop/iss/${hex("http://localhost:8080/realms/demo")}/aud/${hex("demo-client")}/tide_dpop_auth.html`;
  const served = async (headers, body = page, path = relay) => {
    const srv = await listen((req, res) => {
      if (req.url === path) { res.writeHead(200, headers); res.end(body); } else { res.writeHead(404); res.end(); }
    });
    const dir = scaffold("nextjs-customer-portal", "data/tidecloak.json");
    const res = await run(["--app", dir, "--url", `http://127.0.0.1:${srv.address().port}`]);
    srv.close(); rmSync(dir, { recursive: true, force: true });
    return res;
  };
  const good = { "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'", "Allow-CSP-From": "*" };
  let live = await served(good);
  c.ok("doctor --url passes a correctly served relay page, using the adapter's real issuer and client",
    live.code === 0 && /the served page is byte-exact/.test(live.out) && /Allow-CSP-From is sent/.test(live.out), live.out.slice(-300));
  live = await served({ "Content-Security-Policy": "frame-src 'self' *" });
  c.ok("doctor --url catches a relay served with the catch-all CSP and no Allow-CSP-From",
    live.code === 1 && /Allow-CSP-From is NOT sent/.test(live.out) && /does not send a script-src policy/.test(live.out));
  live = await served(good, Buffer.concat([page, Buffer.from("\n")]));
  c.ok("doctor --url catches a served page that is one byte off", live.code === 1 && /not the known-good bytes/.test(live.out));
  live = await served(good, page, "/tide_dpop");
  c.ok("doctor --url catches a relay URL that 404s", live.code === 1 && /the relay URL answers 404/.test(live.out));

  // --- tide-doctor.sh --realm: read-only realm checks -----------------------------------------
  const realm = async (attrs, pending) => {
    const srv = await listen((req, res) => {
      const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url.startsWith("/realms/master/protocol/openid-connect/token")) return json({ access_token: "t", expires_in: 60 });
      if (req.url === "/admin/realms/demo") return json({ realm: "demo", attributes: attrs });
      if (req.url.startsWith("/admin/realms/demo/iga/change-requests")) return json(pending);
      res.writeHead(404); res.end("{}");
    });
    const dir = scaffold("nextjs-customer-portal", "data/tidecloak.json");
    const res = await run(["--app", dir, "--realm", "demo"], { TIDECLOAK_URL: `http://127.0.0.1:${srv.address().port}`, KC_BOOTSTRAP_ADMIN_PASSWORD: "x" });
    srv.close(); rmSync(dir, { recursive: true, force: true });
    return res;
  };
  let rr = await realm({ isIGAEnabled: "true", "iga.attestor": "tide" }, []);
  c.ok("doctor --realm passes a governed Tide realm with nothing pending",
    rr.code === 0 && /IGA \(governance\) is enabled/.test(rr.out) && /Tide mode/.test(rr.out) && /no pending change requests/.test(rr.out), rr.out.slice(-400));
  rr = await realm({ isIGAEnabled: "true", "iga.attestor": "tide" }, [{ id: "a", actionType: "CREATE_USER" }, { id: "b", actionType: "DISABLE_IGA" }]);
  c.ok("doctor --realm fails on a pending DISABLE_IGA and warns off a drain",
    rr.code === 1 && /destructive change request is PENDING: DISABLE_IGA/.test(rr.out) && /do NOT run a drain loop/.test(rr.out));
  rr = await realm({ isIGAEnabled: "true" }, [{ id: "a", actionType: "CREATE_USER" }]);
  c.ok("doctor --realm warns on Tideless governance and on unapplied requests",
    rr.code === 0 && /iga\.attestor is 'unset'/.test(rr.out) && /1 change request\(s\) are still PENDING/.test(rr.out));

  return c.results;
}
