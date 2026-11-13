import {gitArguments} from "./git-arguments/main.ts";
import {testEnvironment} from "./test-environment.ts";
// A real registry, tarball, pnpm store and committed candidate for preparation
// controls. The registry is closed before the frozen tree is prepared.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { chmodSync,copyFileSync,mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, lstatSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TestContext } from "node:test";
import {withPackageManager} from "../inputs/package-manager.ts";
import {fixtureInputs} from "../inputs/node-inputs-test-fixture.ts";
import {acquire as acquireNodeInputs} from "../inputs/node-inputs.ts";
import {nodePin} from "../bootstrap/node.ts";
import {fileURLToPath} from "node:url";
import {copyModuleClosure} from "./module-closure-fixture.ts";

export const REGISTRY_FIXTURE_PACKAGE = "nts-registry-input-fixture";
export const REGISTRY_FIXTURE_MARKER = "candidate-registry-input-v1";
export const SECOND_REGISTRY_PACKAGE = "nts-registry-input-fixture-second";
export const SECOND_REGISTRY_MARKER = "candidate-registry-input-second-v1";
export type CommandResult = { status: number | null; stdout: string; stderr: string };

export function command(program: string, args: string[], cwd: string, input?: Buffer, overrides:NodeJS.ProcessEnv={}): Promise<CommandResult> {
  if(program==="pnpm"){
    assert.equal(input,undefined,"the pinned manager takes command arguments, not stdin");
    assert.equal(Object.keys(overrides).length,0,"manager capabilities come from the canonical host environment");
    return withPackageManager(cwd,{},async manager=>({status:0,stdout:await manager.run(args),stderr:""}));
  }
  return new Promise((resolve, reject) => {
    const env=testEnvironment(overrides);
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
  integrity: string; mainIdentity: string; registryRequests: string[]; inputs:string; nodeInputs:string;
};

/** The optional hook is the submission cache-population seam for the fix. */
export async function registryInputsFixture(t: TestContext,
  populateCache?: (fixture: RegistryInputsFixture) => Promise<void>): Promise<RegistryInputsFixture> {
  const root = mkdtempSync(join(tmpdir(), "nts-registry-inputs-"));
  const main = join(root, "main"), candidate = join(root, "candidate"), frozen = join(root, "frozen");
  const store = join(root, "store"), packageRoot = join(root, "artifact/package");
  for (const directory of [main, frozen, store, packageRoot]) mkdirSync(directory, { recursive: true });
  t.after(() => { if (!process.env.REGISTRY_INPUTS_FIXTURE_KEEP) {
    const writable=(path:string)=>{if(lstatSync(path).isDirectory()){chmodSync(path,0o755);for(const name of readdirSync(path))writable(join(path,name));}};
    writable(root);rmSync(root, { recursive: true, force: true });
  } });
  const toolingRoot=fileURLToPath(new URL("../../",import.meta.url));
  // Stage production before the fixture creates its private recipe bytes.
  const nodeFiles=copyModuleClosure(["tooling/inputs/node-inputs.ts"],main);
  const table=fixtureInputs(main,nodePin(toolingRoot)),consumer=join(root,"input-consumer"),linkerDir=join(consumer,"tooling/inputs");
  const privateRecipe=JSON.parse(readFileSync(join(main,"build/node-deps/recipes.json"),"utf8"));
  assert.equal(privateRecipe.node,nodePin(toolingRoot),"the registry fixture owns the selected recipe version");
  assert.deepEqual(Object.keys(privateRecipe.files),["deps/uv/source.c"],"the registry fixture uses only its private source bytes");
  const nodeInputs=join(root,"node-inputs");acquireNodeInputs(main,nodeInputs,table);
  copyModuleClosure(["tooling/inputs/dependency-inputs.ts"],consumer);
  copyFileSync(join(toolingRoot,"tooling/inputs/link.sh"),join(linkerDir,"link.sh"));
  // A frozen destination executes its own Node provisioner and catalog.
  // Commit that real import closure so both clones retain the same authority.
  writeFileSync(join(main,"tooling/inputs/node-inputs.json"),JSON.stringify(table));
  writeFileSync(join(consumer,"package.json"),'{"type":"module"}\n');
  const inputs=join(linkerDir,"link.sh");
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
  writeFileSync(join(main, ".gitignore"), "node_modules/\n/third_party/node\n/third_party/node-source\n/third_party/node-inputs\n");
  writeFileSync(join(main, ".npmrc"), `registry=${origin}/\nstore-dir=${store}\ncache-dir=${join(root,"metadata-cache")}\nstate-dir=${join(root,"state")}\nverify-store-integrity=true\n`);
  const git = (cwd: string, args: string[]) => checked("git", gitArguments(["-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", "-c", "user.name=Registry input fixture",
    "-c", "user.email=fixture@example.invalid", ...args]), cwd);
  await git(main, ["init", "--initial-branch=main"]);
  await git(main, ["add", "package.json", "pnpm-workspace.yaml", ".gitignore", ".npmrc", ".tool-versions", "build/node-deps/recipes.json", ...nodeFiles, "tooling/inputs/node-inputs.json"]);
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
    mainIdentity, registryRequests, inputs, nodeInputs };
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
