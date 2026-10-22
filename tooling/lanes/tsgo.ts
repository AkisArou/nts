// A frontend belongs to a gitlink and its ordered carried patches, never to
// whichever checkout last ran bootstrap. Builds are immutable and shared;
// each tree has its own patched source worktree and target/tsgo link.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SUBMODULE = "third_party/typescript-go";
const HERE = fileURLToPath(import.meta.url);
type Patch = { name: string; text: string };
type Pin = { gitlink: string; patches: Patch[]; key: string };
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const git = (cwd: string, args: string[], input?: string) =>
  execFileSync("git", args, { cwd, input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], maxBuffer: 1 << 26 }).trim();

export function frontendPin(tree: string): Pin {
  const entry = git(tree, ["ls-files", "--stage", "--", SUBMODULE]);
  const gitlink = /^160000 ([0-9a-f]{40}) 0\t/.exec(entry)?.[1];
  if (!gitlink) throw new Error(`no stage-0 gitlink for ${SUBMODULE} in ${tree}`);
  const directory = join(tree, "third_party/patches");
  const patches = (existsSync(directory) ? readdirSync(directory) : [])
    .filter((name) => name.endsWith(".patch")).sort()
    .map((name) => ({ name, text: readFileSync(join(directory, name), "utf8") }));
  // JSON frames names and contents unambiguously, including an empty set.
  return { gitlink, patches, key: `${gitlink}-${hash(JSON.stringify(patches))}` };
}

export const frontendPath = (root: string, pin: Pin): string => join(root, "target/tsgo.d", pin.key, "tsgo");

/** Refuse unrelated source edits rather than overwriting a lane's work. */
export function prepareSource(root: string, tree: string, pin = frontendPin(tree)): string {
  const source = join(tree, SUBMODULE);
  if (lstatSync(source, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(source);
  if (!existsSync(join(source, ".git"))) {
    if (existsSync(source)) rmdirSync(source); // only an empty submodule placeholder
    mkdirSync(dirname(source), { recursive: true });
    git(join(root, SUBMODULE), ["worktree", "add", "--quiet", "--detach", source, pin.gitlink]);
  }
  const record = git(source, ["rev-parse", "--path-format=absolute", "--git-path", "nts-tsgo-patches.json"]);
  const oldHead = git(source, ["rev-parse", "HEAD"]);
  const previous: Patch[] = existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : pin.patches;
  const reversed: Patch[] = [];
  try {
    const dirty = git(source, ["diff", "--binary"]) !== "";
    for (const patch of dirty ? [...previous].reverse() : []) {
      const check = spawnSync("git", ["apply", "--reverse", "--check", "-"], { cwd: source, input: patch.text, stdio: "pipe" });
      if (check.status !== 0) continue;
      git(source, ["apply", "--reverse", "-"], patch.text);
      reversed.push(patch);
    }
    if (git(source, ["status", "--porcelain", "--untracked-files=normal"])) {
      throw new Error(`unrecognised edits in ${source}; only the recorded carried patches may be replaced`);
    }
  } catch (error) {
    for (const patch of reversed.reverse()) git(source, ["apply", "-"], patch.text);
    throw error;
  }
  try {
    if (oldHead !== pin.gitlink) git(source, ["checkout", "--quiet", "--detach", pin.gitlink]);
    // Check the complete series before modifying any file.
    const series = pin.patches.map((patch) => patch.text).join("\n");
    if (series) {
      git(source, ["apply", "--check", "-"], series);
      git(source, ["apply", "-"], series);
    }
  } catch (error) {
    if (git(source, ["rev-parse", "HEAD"]) !== oldHead) git(source, ["checkout", "--quiet", "--detach", oldHead]);
    for (const patch of reversed.reverse()) git(source, ["apply", "-"], patch.text);
    throw error;
  }
  writeFileSync(record, JSON.stringify(pin.patches));
  return source;
}

export function requireFrontend(root: string, tree: string, pin = frontendPin(tree)): string {
  const binary = frontendPath(root, pin);
  const record = join(dirname(binary), "build.json");
  if (!existsSync(binary) || !existsSync(record)) {
    throw new Error(`missing tsgo build ${pin.key}: ${binary}\nRun sh ${join(tree, "tooling/bootstrap/bootstrap.sh")} --tsgo-only ${root}`);
  }
  accessSync(binary, constants.X_OK);
  const built = JSON.parse(readFileSync(record, "utf8"));
  if (built.key !== pin.key || built.sha256 !== hash(readFileSync(binary))) {
    throw new Error(`tsgo build ${pin.key} was modified: ${binary}; immutable builds must not be replaced`);
  }
  return binary;
}

export function linkFrontend(root: string, tree: string, pin = frontendPin(tree)): string {
  const binary = requireFrontend(root, tree, pin);
  const link = join(tree, "target/tsgo");
  mkdirSync(dirname(link), { recursive: true });
  // Rename the link atomically. In bootstrap this also migrates an old
  // regular target/tsgo, after its replacement has been fully published.
  const staging = `${link}.partial-${process.pid}`;
  try {
    symlinkSync(binary, staging);
    renameSync(staging, link);
  } finally {
    rmSync(staging, { force: true });
  }
  return binary;
}

function buildLocked(root: string, tree: string): string {
  const pin = frontendPin(tree);
  const binary = frontendPath(root, pin);
  if (existsSync(dirname(binary))) {
    requireFrontend(root, tree, pin);
    prepareSource(root, tree, pin);
    return linkFrontend(root, tree, pin);
  }
  const source = prepareSource(root, tree, pin);
  const state = () => `${frontendPin(tree).key}\n${git(source, ["rev-parse", "HEAD"])}\n${git(source, ["diff", "--binary"])}\n${git(source, ["ls-files", "--others", "--exclude-standard"])}`;
  const before = state();
  const staging = `${dirname(binary)}.partial-${process.pid}`;
  mkdirSync(staging);
  try {
    const built = spawnSync("go", ["build", "-trimpath", "-o", join(staging, "tsgo"), "./cmd/tsgo"], {
      cwd: source, stdio: "inherit", env: { ...process.env, GOWORK: "off" },
    });
    if (built.status !== 0) throw new Error(`go build failed for tsgo ${pin.key}`);
    if (state() !== before) throw new Error(`tsgo inputs changed during build ${pin.key}; nothing published`);
    writeFileSync(join(staging, "build.json"), `${JSON.stringify({ key: pin.key, gitlink: pin.gitlink, patches: pin.patches.map(({ name, text }) => ({ name, sha256: hash(text) })), sha256: hash(readFileSync(join(staging, "tsgo"))) }, null, 2)}\n`);
    renameSync(staging, dirname(binary));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return linkFrontend(root, tree, pin);
}

function main(): void {
  const [action, shared, target] = process.argv.slice(2);
  if (!shared || !target) throw new Error("usage: tsgo.ts <prepare|build|build-locked> <shared checkout> <tree>");
  const root = realpathSync(resolve(shared));
  const tree = realpathSync(resolve(target));
  const pin = frontendPin(tree);
  if (action === "prepare") {
    // Fail before changing a source checkout or its links.
    requireFrontend(root, tree, pin);
    prepareSource(root, tree, pin);
    linkFrontend(root, tree, pin);
  } else if (action === "build") {
    if (!existsSync(join(root, SUBMODULE, ".git"))) git(root, ["submodule", "update", "--init", "--", SUBMODULE]);
    mkdirSync(join(root, "target/tsgo.d"), { recursive: true });
    const result = spawnSync("flock", ["--wait", "900", join(root, "target/tsgo.d", `${pin.key}.lock`), process.execPath, HERE, "build-locked", root, tree, pin.key], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`tsgo build ${pin.key} failed (exit ${result.status ?? result.signal})`);
  } else if (action === "build-locked") {
    if (process.argv[5] !== pin.key) throw new Error("tsgo pin changed while waiting for the build lock");
    process.stdout.write(`${buildLocked(root, tree)}\n`);
  } else {
    throw new Error(`unknown tsgo action ${action}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === HERE) {
  try { main(); } catch (error) {
    console.error(`tsgo: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
