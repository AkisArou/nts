#!/usr/bin/env node
/** Stage the checked native fixture and generate its opt-in renderer build. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { sha256File } from "./hash.ts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { activeChromiumBuild, buildProfile } from "./profiles.ts";

const root = resolve(import.meta.dirname, "../..");
const source = resolve(root, "third_party/chromium/src");
const depot = resolve(root, "third_party/chromium/depot_tools");
const output = resolve(root, "target/chromium");
const lane = resolve(root, "runtime/chromium");
const fixture = resolve(lane, "embedder/program");
const staged = resolve(source, "nts");
const backend = process.argv[2];
const usage = "Usage: node tooling/chromium/probe.ts <c|llvm> [--profile baseline|perf] [--app <archive>]";
if (backend !== "c" && backend !== "llvm") throw new Error(usage);
// `--app` stages an app's program archive (tooling/chromium/app.ts) beside the
// probe's, for the nts_app executable.
const options = new Map<string, string>();
for (let i = 3; i < process.argv.length; i += 2) {
  const [name, value] = [process.argv[i], process.argv[i + 1]];
  if ((name !== "--profile" && name !== "--app") || value === undefined || options.has(name)) throw new Error(usage);
  options.set(name, value);
}
const selectedProfile = buildProfile(options.has("--profile") ? ["--profile", options.get("--profile")!] : []);
const appArchive = options.get("--app");
const activeBuild = activeChromiumBuild(root);
if (activeBuild) throw new Error(`Build ${activeBuild} is running; finish it before staging the probe`);

const hash = sha256File;
const revision = (dir: string): string => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const lock = JSON.parse(readFileSync(resolve(root, "third_party/chromium/upstream.lock.json"), "utf8")) as { chromium: { revision: string }; depot_tools: { revision: string } };
if (revision(source) !== lock.chromium.revision || revision(depot) !== lock.depot_tools.revision) throw new Error("Checkout differs from source/tool lock");
const baseline = JSON.parse(readFileSync(resolve(output, "baseline-smoke/result.json"), "utf8")) as { chromiumRevision: string; probeBackend?: string; sourceDiffSha256: string };
const emptyHash = createHash("sha256").update("").digest("hex");
if (baseline.chromiumRevision !== lock.chromium.revision || baseline.probeBackend || baseline.sourceDiffSha256 !== emptyHash) {
  throw new Error("Record a successful unmodified baseline smoke at this pin first");
}

if (execFileSync("git", ["-C", source, "diff", "HEAD", "--binary"], { encoding: "utf8" }) !== "") {
  throw new Error("The public-client experiment requires unmodified tracked Chromium source");
}

// Every staged file is derived. Refuse an unowned directory or manual edits.
const manifestFile = resolve(staged, "manifest.json");
if (existsSync(staged) && !existsSync(manifestFile)) throw new Error(`Unowned staging directory: ${staged}`);
if (existsSync(manifestFile)) {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { filesRelativeTo?: string; files: Record<string, string> };
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (hash(resolve(manifest.filesRelativeTo === "chromium" ? source : staged, path)) !== expected) throw new Error(`Manually changed staged file: ${path}`);
  }
}
const blinkStaging = resolve(source, "third_party/blink/renderer/nts");
if (existsSync(blinkStaging)) {
  const prior = JSON.parse(readFileSync(manifestFile, "utf8")) as { files: Record<string, string> };
  if (!prior.files["third_party/blink/renderer/nts/BUILD.gn"]) throw new Error(`Unowned staging directory: ${blinkStaging}`);
}
const argsFile = resolve(source, selectedProfile.directory, "args.gn");
const profile = readFileSync(resolve(import.meta.dirname, selectedProfile.argumentsFile), "utf8");
const probeProfile = (variant: string, app = false): string => app
  ? `${profile}\nroot_extra_deps = [ "//nts:nts_shell", "//nts:nts_app", "//nts:nts_app_shell" ]\nnts_probe_backend = "${variant}"\nnts_app_backend = "${variant}"\n`
  : `${profile}\nroot_extra_deps = [ "//nts:nts_shell" ]\nnts_probe_backend = "${variant}"\n`;
const oldArgs = existsSync(argsFile) ? readFileSync(argsFile, "utf8") : profile;
if (![profile, probeProfile("c"), probeProfile("llvm"), probeProfile("c", true), probeProfile("llvm", true)].includes(oldArgs)) {
  throw new Error(`Build arguments differ from the owned ${selectedProfile.name}/probe profiles`);
}

execFileSync(process.execPath, [resolve(fixture, "check.ts")], { cwd: root, stdio: "inherit" });
const files: Record<string, string> = {};
function stage(input: string, path: string): void {
  const destination = resolve(staged, path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(input, destination);
  files[`nts/${path}`] = hash(destination);
}
// Staged flat into //nts, whatever directory each lives in here: the content
// embedder, the Blink adapter, the benchmark harnesses, the C ABI.
const sources: Record<string, string[]> = {
  embedder: ["BUILD.gn", "probe.gni", "probe.c", "probe.h", "probe_main.cc", "probe_observer.cc", "probe_observer.h"],
  adapter: ["dom_bridge.cc", "dom_bridge.h", "dom_bridge_bindings.h", "dom_canvas.cc", "dom_context.h", "dom_idl.cc"],
  "benchmarks/harness": ["binding_benchmark.cc", "binding_benchmark.h", "rows_benchmark.cc", "rows_benchmark.h", "kernels_benchmark.cc", "kernels_benchmark.h"],
  // dom_idl.h is generated from Blink's IDL (tooling/chromium/bindgen).
  "dom/abi": ["dom_abi.h", "dom_idl.h"],
  host: ["host.c", "host.h"],
};
for (const [directory, names] of Object.entries(sources)) {
  for (const name of names) stage(resolve(lane, directory, name), name);
}
// Beside dom_abi.h and dom_bridge.h, which include it: the one C++ half of
// StringView, the same for both backends.
stage(resolve(root, "runtime/c/nts_string_view.h"), "nts_string_view.h");
if (appArchive !== undefined) {
  for (const name of ["app.h", "app_observer.cc", "app_observer.h", "app_main.cc", "app_scheme.cc", "app_scheme.h", "app_permissions.cc", "app_permissions.h", "shell_main.cc"]) stage(resolve(lane, "host", name), name);
  stage(resolve(appArchive), `generated/app/${backend}/program.a`);
}
for (const variant of ["c", "llvm"] as const) {
  const generated = resolve(output, "native-bootstrap", variant === "c" ? "probe" : "probe-llvm", "linux-gnu-x86_64");
  for (const file of ["program.h", "nts_runtime.h", "nts_string_view.h"]) stage(resolve(generated, file), `generated/${variant}/${file}`);
  stage(resolve(output, "native-bootstrap", `chromium-${variant}-probe.a`), `generated/${variant}/program.a`);
}
mkdirSync(blinkStaging, { recursive: true });
copyFileSync(resolve(lane, "adapter/blink.BUILD.gn"), resolve(blinkStaging, "BUILD.gn"));
files["third_party/blink/renderer/nts/BUILD.gn"] = hash(resolve(blinkStaging, "BUILD.gn"));
writeFileSync(manifestFile, `${JSON.stringify({ chromiumRevision: lock.chromium.revision, integration: "owned-shell-client-factories-and-blink-target", filesRelativeTo: "chromium", files }, null, 2)}\n`);
const exclude = execFileSync("git", ["-C", source, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], { encoding: "utf8" }).trim();
const existing = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
const exclusions = ["/nts/", "/third_party/blink/renderer/nts/"];
const missing = exclusions.filter(path => !existing.split("\n").includes(path));
if (missing.length) writeFileSync(exclude, `${existing}\n# NTS-owned derived renderer experiments\n${missing.join("\n")}\n`);
mkdirSync(dirname(argsFile), { recursive: true });
writeFileSync(argsFile, probeProfile(backend, appArchive !== undefined));
execFileSync(resolve(depot, "gn"), ["gen", selectedProfile.directory], {
  cwd: source, stdio: "inherit", env: { ...process.env, PATH: `${depot}${delimiter}${process.env.PATH ?? ""}`, DEPOT_TOOLS_UPDATE: "0", DEPOT_TOOLS_METRICS: "0" },
});
console.log(`Generated ${backend} nts_shell ${selectedProfile.name} renderer probe without upstream patches. Build with chromium.ts build --profile ${selectedProfile.name}, then run smoke.ts against nts_shell with fourth argument ${backend}.`);
