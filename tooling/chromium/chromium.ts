#!/usr/bin/env node
/** Opt-in Chromium checkout/build; run directly with Node 24. */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statfsSync, writeFileSync } from "node:fs";
import { delimiter, relative, resolve } from "node:path";
import { activeChromiumBuild, buildProfile } from "./profiles.ts";

const root = resolve(import.meta.dirname, "../..");
const vendor = resolve(root, "third_party/chromium");
const source = resolve(vendor, "src");
const depot = resolve(vendor, "depot_tools");
const profile = buildProfile(process.argv.slice(3));
const buildDir = resolve(source, profile.directory);
const evidence = resolve(root, profile.evidence);
const writerPidFile = resolve(root, "target/chromium/build.pid");
const hash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

interface Pin { url: string; revision: string; version?: string }
interface Lock { chromium: Pin; depot_tools: Pin }
const settings = (): Lock => JSON.parse(readFileSync(resolve(vendor, "upstream.lock.json"), "utf8"));
const revision = (path: string): string => execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const freeGiB = (): number => {
  const stats = statfsSync(vendor);
  return stats.bavail * stats.bsize / 1024 ** 3;
};
const environment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${depot}${delimiter}${process.env.PATH ?? ""}`,
  // Tool source updates are explicit pin bumps; CIPD follows that tool pin.
  DEPOT_TOOLS_UPDATE: "0",
  DEPOT_TOOLS_METRICS: "0",
});

function run(argv: string[], cwd = root, env = process.env): void {
  console.log(`[${relative(root, cwd) || "."}] ${argv.join(" ")}`);
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${argv[0]} failed: ${result.signal ?? result.status}`);
}

function requirePins(): void {
  const lock = settings();
  for (const [name, path] of [["chromium", source], ["depot_tools", depot]] as const) {
    if (!existsSync(resolve(path, ".git"))) throw new Error(`Missing ${path}; run bootstrap first`);
    const actual = revision(path);
    if (actual !== lock[name].revision) {
      throw new Error(`${name} is ${actual}, expected ${lock[name].revision}; review the pin manually`);
    }
  }
}

function clonePinned(name: keyof Lock, path: string): void {
  const pin = settings()[name];
  if (existsSync(resolve(path, ".git"))) {
    if (revision(path) !== pin.revision) throw new Error(`Existing ${path} differs from its lock`);
    return;
  }
  if (existsSync(path) && readdirSync(path).length) throw new Error(`Existing non-repository directory: ${path}`);
  if (name === "chromium") {
    const submodule = relative(root, path);
    const tracked = execFileSync("git", ["ls-files", "--stage", "--", submodule], { cwd: root, encoding: "utf8" });
    if (tracked.startsWith("160000 ")) {
      run(["git", "submodule", "update", "--init", "--depth", "1", "--", submodule]);
    } else {
      if (!pin.version) throw new Error("Chromium lock needs a release version");
      run(["git", "clone", "--depth", "1", "--no-tags", "--branch", pin.version, pin.url, path]);
    }
  } else {
    run(["git", "init", path]);
    run(["git", "remote", "add", "origin", pin.url], path);
    run(["git", "fetch", "--depth", "1", "origin", pin.revision], path);
    run(["git", "checkout", "--detach", "FETCH_HEAD"], path);
  }
  if (revision(path) !== pin.revision) throw new Error(`Downloaded ${name} does not match the source lock`);
}

function bootstrap(): void {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("The initial profile requires Linux x86-64");
  if (!existsSync(source) && freeGiB() < 100) throw new Error("The initial Chromium checkout needs at least 100 GiB free");
  clonePinned("depot_tools", depot);
  clonePinned("chromium", source);
  requirePins();
  // gclient can run via vpython without initializing gn/autoninja's Python
  // launcher when source auto-updates are disabled. Bootstrap without moving
  // the pinned depot_tools repository.
  if (!existsSync(resolve(depot, "python3_bin_reldir.txt"))) {
    run([resolve(depot, "ensure_bootstrap")], vendor, environment());
  }
}

function sync(jobs: number): void {
  requirePins();
  const manifest = resolve(root, "target/chromium/sync.json");
  mkdirSync(resolve(root, "target/chromium"), { recursive: true });
  run([resolve(depot, "gclient"), "sync", "--nohooks", "--shallow", "--no-history", "--jobs", String(jobs),
    "--revision", `src@${settings().chromium.revision}`, "--output-json", manifest], vendor, environment());
}

function hooks(): void {
  requirePins();
  run([resolve(depot, "gclient"), "runhooks"], vendor, environment());
}

function generate(): void {
  requirePins();
  mkdirSync(buildDir, { recursive: true });
  const content = readFileSync(resolve(import.meta.dirname, profile.argumentsFile), "utf8");
  const destination = resolve(buildDir, "args.gn");
  if (existsSync(destination) && readFileSync(destination, "utf8") !== content) {
    throw new Error(`${destination} differs from the ${profile.name} profile; review before replacing`);
  }
  writeFileSync(destination, content);
  run([resolve(depot, "gn"), "gen", relative(source, buildDir)], source, environment());
}

function activeBuildPid(): number | undefined {
  return activeChromiumBuild(root);
}

function selectedTarget(): { name: string; label: string } {
  const args = resolve(buildDir, "args.gn");
  const native = existsSync(args) && readFileSync(args, "utf8").includes('root_extra_deps = [ "//nts:nts_shell" ]');
  return native ? { name: "nts_shell", label: "//nts:nts_shell" } : { name: "content_shell", label: "//content/shell:content_shell" };
}

function build(jobs: number): void {
  requirePins();
  const active = activeBuildPid();
  if (active && active !== process.pid) throw new Error(`Build ${active} is already running`);
  if (!existsSync(resolve(buildDir, "build.ninja"))) throw new Error("Missing generated build; run gen first");
  mkdirSync(evidence, { recursive: true });
  mkdirSync(resolve(root, "target/chromium"), { recursive: true });
  writeFileSync(writerPidFile, `${process.pid}\n`);
  const startedAt = new Date().toISOString();
  const target = selectedTarget();
  const resultFile = resolve(evidence, "build-result.json");
  writeFileSync(resultFile, `${JSON.stringify({ state: "running", pid: process.pid, startedAt, jobs, target: target.name })}\n`);
  try {
    const targets = target.name === "nts_shell" ? ["nts_shell", "content_shell"] : [target.name];
    run([resolve(depot, "autoninja"), "-C", relative(source, buildDir), "-j", String(jobs), ...targets], source, environment());
    const resources = execFileSync(resolve(depot, "gn"), ["desc", relative(source, buildDir), target.label, "runtime_deps"], { cwd: source, env: environment(), encoding: "utf8" });
    writeFileSync(resolve(evidence, "runtime-deps.txt"), resources);
    const manifest = resolve(source, "nts/manifest.json");
    writeFileSync(resultFile, `${JSON.stringify({ state: "passed", startedAt, finishedAt: new Date().toISOString(), jobs, profile: profile.name, target: target.name, chromiumRevision: revision(source),
      gnArgsSha256: hash(resolve(buildDir, "args.gn")), executableSha256: hash(resolve(buildDir, target.name)), nativeManifestSha256: target.name === "nts_shell" ? hash(manifest) : undefined,
      v8ControlExecutableSha256: hash(resolve(buildDir, "content_shell")), targets })}\n`);
  } catch (error) {
    writeFileSync(resultFile, `${JSON.stringify({ state: "failed", startedAt, finishedAt: new Date().toISOString(), target: target.name, error: String(error) })}\n`);
    throw error;
  }
}

function backgroundBuild(jobs: number): void {
  requirePins();
  mkdirSync(evidence, { recursive: true });
  const pidFile = writerPidFile;
  const active = activeBuildPid();
  if (active) throw new Error(`Build ${active} is already running; finish it before starting another profile`);
  const log = openSync(resolve(evidence, "build.log"), "a");
  const child = spawn(process.execPath, [import.meta.filename, "build", "--jobs", String(jobs), "--profile", profile.name], {
    cwd: root, detached: true, stdio: ["ignore", log, log],
  });
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.unref();
  closeSync(log);
  mkdirSync(resolve(root, "target/chromium"), { recursive: true });
  writeFileSync(pidFile, `${child.pid}\n`);
  console.log(`Build ${child.pid} started; log: ${profile.evidence}/build.log; completion: ${profile.evidence}/build-result.json`);
}

function status(): void {
  const lock = settings();
  console.log(`Chromium ${lock.chromium.version}`);
  for (const [name, path] of [["chromium", source], ["depot_tools", depot]] as const) {
    console.log(`${name}: ${existsSync(resolve(path, ".git")) ? revision(path) : "not checked out"} (expected ${lock[name].revision})`);
  }
  const target = selectedTarget();
  console.log(`Build: ${buildDir}\nTarget: ${target.name}\nExecutable exists: ${existsSync(resolve(buildDir, target.name))}\nFree disk: ${freeGiB().toFixed(1)} GiB`);
  const active = activeBuildPid();
  console.log(`Build process: ${active ?? "not running"}`);
  const result = resolve(evidence, "build-result.json");
  if (existsSync(result)) console.log(`Last build record: ${readFileSync(result, "utf8").trim()}`);
}

try {
  const [command, ...options] = process.argv.slice(2);
  let jobs = 8;
  let background = false;
  for (let index = 0; index < options.length; ++index) {
    if (options[index] === "--background" && command === "build") background = true;
    else if (options[index] === "--jobs") {
      jobs = Number(options[++index]);
      if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error("--jobs must be a positive integer");
    } else if (options[index] === "--profile") {
      ++index; // Validated before selecting directories.
    } else throw new Error(`Unknown option: ${options[index]}`);
  }
  if (["bootstrap", "sync", "hooks", "gen"].includes(command)) {
    const active = activeBuildPid();
    if (active) throw new Error(`Build ${active} is running; finish it before changing the checkout or build graph`);
  }
  switch (command) {
    case "bootstrap": bootstrap(); break;
    case "sync": sync(jobs); break;
    case "hooks": hooks(); break;
    case "gen": generate(); break;
    case "build": if (background) backgroundBuild(jobs); else build(jobs); break;
    case "status": status(); break;
    default: throw new Error("Usage: node tooling/chromium/chromium.ts <bootstrap|sync|hooks|gen|build|status> [--profile baseline|perf] [--jobs 8] [build: --background]");
  }
} catch (error) {
  console.error(`chromium: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
