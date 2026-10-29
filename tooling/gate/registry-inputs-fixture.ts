// A real registry, tarball, pnpm store and committed candidate for preparation
// controls. The registry is closed before the frozen tree is prepared.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TestContext } from "node:test";

export const REGISTRY_FIXTURE_PACKAGE = "nts-registry-input-fixture";
export const REGISTRY_FIXTURE_MARKER = "candidate-registry-input-v1";
export const SECOND_REGISTRY_PACKAGE = "nts-registry-input-fixture-second";
export const SECOND_REGISTRY_MARKER = "candidate-registry-input-second-v1";
export type CommandResult = { status: number | null; stdout: string; stderr: string };

export function command(program: string, args: string[], cwd: string, input?: Buffer, overrides:NodeJS.ProcessEnv={}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const env={...process.env,...overrides};
    for(const key of ["NTS_GATE_STEP","NTS_GATE_STEP_RESULT","NTS_GATE_STEP_ATTEMPT"])delete env[key];
    const child = spawn(program, args, { cwd, env: { ...env, CI: "true", NO_COLOR: "1",
      HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "127.0.0.1" }, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function checked(program: string, args: string[], cwd: string): Promise<CommandResult> {
  const result = await command(program, args, cwd);
  assert.equal(result.status, 0, `${program} ${args.join(" ")}:\n${result.stdout}${result.stderr}`);
  return result;
}

export function treeIdentity(root: string): string {
  const hash = createHash("sha256");
  function visit(directory: string, prefix: string): void {
    for (const name of readdirSync(directory).sort()) {
      if (name === ".git") continue;
      const path = join(directory, name), relative = prefix + name;
      hash.update(relative + "\0");
      if (lstatSync(path).isSymbolicLink()) hash.update("link\0" + readlinkSync(path));
      else if (statSync(path).isDirectory()) visit(path, relative + "/");
      else hash.update(readFileSync(path));
    }
  }
  visit(root, "");
  return hash.digest("hex");
}

export type RegistryInputsFixture = {
  root: string; main: string; candidate: string; frozen: string; store: string;
  integrity: string; mainIdentity: string; registryRequests: string[];
};

/** The optional hook is the submission cache-population seam for the fix. */
export async function registryInputsFixture(t: TestContext,
  populateCache?: (fixture: RegistryInputsFixture) => Promise<void>): Promise<RegistryInputsFixture> {
  const root = mkdtempSync(join(tmpdir(), "nts-registry-inputs-"));
  const main = join(root, "main"), candidate = join(root, "candidate"), frozen = join(root, "frozen");
  const store = join(root, "store"), packageRoot = join(root, "artifact/package");
  for (const directory of [main, frozen, store, packageRoot]) mkdirSync(directory, { recursive: true });
  t.after(() => { if (!process.env.REGISTRY_INPUTS_FIXTURE_KEEP) rmSync(root, { recursive: true, force: true }); });
  const packageJson = { name: REGISTRY_FIXTURE_PACKAGE, version: "1.0.0", type: "module",
    exports: "./index.js", license: "MIT" };
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify(packageJson));
  writeFileSync(join(packageRoot, "index.js"), `export const marker = ${JSON.stringify(REGISTRY_FIXTURE_MARKER)};\n`);
  writeFileSync(join(packageRoot, "LICENSE"), "MIT fixture content; created only for this preparation control.\n");
  const tarball = join(root, "package.tgz");
  await checked("tar", ["-czf", tarball, "-C", join(root, "artifact"), "package"], root);
  const bytes = readFileSync(tarball), integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
  const secondJson={...packageJson,name:SECOND_REGISTRY_PACKAGE};
  writeFileSync(join(packageRoot,"package.json"),JSON.stringify(secondJson));
  writeFileSync(join(packageRoot,"index.js"),`export const marker = ${JSON.stringify(SECOND_REGISTRY_MARKER)};\n`);
  const secondTar=join(root,"second.tgz");await checked("tar",["-czf",secondTar,"-C",join(root,"artifact"),"package"],root);
  const secondBytes=readFileSync(secondTar),secondIntegrity="sha512-"+createHash("sha512").update(secondBytes).digest("base64");
  const registryRequests: string[] = [];
  let origin = "";
  const registry = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture").pathname;
    registryRequests.push(path);
    const second=path.startsWith("/"+SECOND_REGISTRY_PACKAGE),name=second?SECOND_REGISTRY_PACKAGE:REGISTRY_FIXTURE_PACKAGE;
    const metadata=second?secondJson:packageJson,content=second?secondBytes:bytes,sri=second?secondIntegrity:integrity;
    if (path === "/" + name) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ name, "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { ...metadata, dist: { integrity:sri,
          tarball: origin + "/" + name + "/-/package.tgz" } } } }));
    } else if (path.endsWith("/-/package.tgz")) {
      response.setHeader("Content-Type", "application/octet-stream");
      response.end(content);
    } else { response.statusCode = 404; response.end("fixture registry has no such package"); }
  });
  registry.listen(0, "127.0.0.1");
  await once(registry, "listening");
  const address = registry.address();
  assert.ok(address !== null && typeof address !== "string");
  origin = "http://127.0.0.1:" + address.port;
  t.after(() => { if (registry.listening) registry.close(); });

  writeFileSync(join(main, "package.json"), JSON.stringify({ name: "inputs-main-fixture", private: true,
    packageManager: "pnpm@10.15.0" }));
  writeFileSync(join(main, "pnpm-workspace.yaml"), "packages:\n  - test/*\n");
  writeFileSync(join(main, ".gitignore"), "node_modules/\n");
  writeFileSync(join(main, ".npmrc"), `registry=${origin}/\nstore-dir=${store}\ncache-dir=${join(root,"metadata-cache")}\nstate-dir=${join(root,"state")}\nverify-store-integrity=true\n`);
  const git = (cwd: string, args: string[]) => checked("git", ["-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", "-c", "user.name=Registry input fixture",
    "-c", "user.email=fixture@example.invalid", ...args], cwd);
  await git(main, ["init", "--initial-branch=main"]);
  await git(main, ["add", "package.json", "pnpm-workspace.yaml", ".gitignore", ".npmrc"]);
  await git(main, ["commit", "-m", "fixture main has no registry dependency or test importer"]);
  mkdirSync(join(main, "node_modules"));
  const mainIdentity = treeIdentity(main);
  await git(root, ["clone", "--quiet", "--no-hardlinks", main, candidate]);
  const importer = join(candidate, "test/new-importer");
  mkdirSync(importer, { recursive: true });
  writeFileSync(join(importer, "package.json"), JSON.stringify({ name: "new-test-importer", private: true,
    type: "module", devDependencies: { [REGISTRY_FIXTURE_PACKAGE]: "1.0.0" } }));
  writeFileSync(join(importer, "probe.mjs"), `import { marker } from ${JSON.stringify(REGISTRY_FIXTURE_PACKAGE)};\n`
    + `if (marker !== ${JSON.stringify(REGISTRY_FIXTURE_MARKER)}) throw new Error('main dependency fallback');\nconsole.log(marker);\n`);
  await checked("pnpm", ["install", "--ignore-scripts", "--fetch-retries=0", "--reporter=append-only"], candidate);
  await git(candidate, ["add", "pnpm-lock.yaml", "test/new-importer"]);
  await git(candidate, ["commit", "-m", "candidate adds a registry dev dependency in a new importer"]);
  const fixture: RegistryInputsFixture = { root, main, candidate, frozen, store, integrity,
    mainIdentity, registryRequests };
  // Seed acquisition is allowed here; preparation below cannot contact even
  // this isolated registry once the submission cache has been populated.
  await populateCache?.(fixture);
  await new Promise<void>((resolve, reject) => registry.close(error => error ? reject(error) : resolve()));
  await git(root, ["clone", "--quiet", "--no-hardlinks", candidate, frozen]);
  await git(frozen, ["checkout", "--quiet", "--detach", "HEAD"]);
  const installed = await command(process.execPath, [join(importer, "probe.mjs")], candidate);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(installed.stdout.trim(), REGISTRY_FIXTURE_MARKER);
  assert.equal(treeIdentity(main), mainIdentity, "submission seeding must leave main unchanged");
  return fixture;
}
