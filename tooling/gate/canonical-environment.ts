// One environment contract for landing, pinned and full gates. A launcher is
// not allowed to choose verdict policy; standalone experiments are explicit.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {captureRunTemporary,pruneRunTemporaries,finishRunTemporary,type RunTemporary} from "./run-temporary.ts";

export const HOST_CAPABILITIES = [
  "PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "CARGO_HOME", "RUSTUP_HOME",
  "JAVA_HOME", "JDK_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_AVD_HOME", "DEBUGINFOD_URLS",
  "CC", "CXX", "RUSTC", "RUSTDOC", "NTS_LLVM_CC", "NTS_LLVM_AS", "NTS_BIND_CC",
  "GI_GIR_PATH", "XDG_DATA_DIRS", "NTS_NAPI_INCLUDE", "NTS_APPLE_ROOT", "NTS_APPLE_SDK",
  "NTS_IOS_SIMULATOR_SDK", "NTS_WINDOWS_ROOT", "NTS_WIN32_WINMD", "NTS_WINRT_METADATA",
  "NTS_APPLE_SSH", "NTS_WINDOWS_SSH", "NTS_IOS_DEVICE", "SSH_AUTH_SOCK",
] as const;

export const FIXED_AMBIENT: Readonly<Record<string, string>> = {
  LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", FORCE_COLOR: "0", TERM: "dumb",
};
export const UNSET_AMBIENT = [
  "LANGUAGE", "NODE_OPTIONS", "NODE_PATH", "NODE_ICU_DATA", "NODE_PENDING_DEPRECATION",
  "NODE_REPL_EXTERNAL_MODULE", "NODE_NO_WARNINGS", "NODE_ENV", "NODE_TEST_CONTEXT", "NO_COLOR",
  "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "JDK_JAVAC_OPTIONS", "_JAVA_OPTIONS", "JAVA_OPTS", "JVM_OPTS", "CLASSPATH",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH",
  "CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS", "CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "LIBRARY_PATH",
  // Every audited GTK/Chromium gate path starts its own Xvfb and assigns DISPLAY.
  "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY",
] as const;

// Parent entry protocol, not capabilities forwarded to programs under test.
const PARENT = new Set([
  "NTS_LAND_HOME", "NTS_LAND_AUTHOR_BRANCH", "NTS_LAND_AUTHOR_ADDRESS", "NTS_LAND_TRAIN_MAX",
  "NTS_LAND_LOCKED", "NTS_LAND_ENTRY", "NTS_LAND_FAST",
  "NTS_LAND_SUBMISSION_UNIT", "NTS_LAND_TRAIN_UNIT", "NTS_LAND_TRAIN_DIRECTORY", "NTS_LAND_TRAIN_TRACE",
]);
const HOST = new Set<string>(HOST_CAPABILITIES);
const EXTRA_POLICY = new Set([
  "CARGO_INCREMENTAL", "CARGO_BUILD_JOBS", "CARGO_BUILD_TARGET", "CARGO_TARGET_DIR",
  "CARGO_ENCODED_RUSTFLAGS", "CARGO_ENCODED_RUSTDOCFLAGS", "RUSTFLAGS", "RUSTDOCFLAGS",
  "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "RUSTC_BOOTSTRAP", "RUSTUP_TOOLCHAIN", "RUST_TEST_THREADS",
]);
const INFRASTRUCTURE = new Set([
  "NTS_GATE_TREE", "NTS_GATE_TARGET", "NTS_GATE_RUN_DIR", "NTS_GATE_SETUP_ONLY",
  "NTS_GATE_LOCK_FD", "NTS_GATE_SCOPE_EXPECTED",
]);
const EXPERIMENTS = new Set([
  ...EXTRA_POLICY, "NTS_GATE_STEPS", "NTS_GATE_SLOTS", "NTS_GATE_JOBS", "NTS_JOBS", "NTS_GATE_MEM_GB",
  "NTS_GATE_FRONTENDS", "NTS_GATE_FAIL_FAST", "NTS_GATE_ACCEPT_SKIP", "NTS_GATE_TIME_STRICT", "NTS_GATE_RECORD_TIMES",
  "NTS_BIN", "NTS_SUITE_BIN", "NTS_CHECKERS", "NTS_INTEROP_PROJECTS", "NTS_DOCTEST_CRATES", "NTS_COREDUMPS",
  "NTS_RC_NAIVE", "NTS_BENCH_AGREE_FLOOR", "NTS_DEX_METHOD_FLOOR", "NTS_BACKEND", "NTS_RC", "NTS_POISON", "NTS_SANITIZE",
  "NTS_KEEP_TEMP", "NTS_TRACE_LOWERING", "NTS_ARRIVALS", "NTS_DIFF_OBJECT_CACHE", "NTS_DIFF_NO_OBJECT_CACHE",
  "NTS_CENSUS_MEMORY_CAP_KB", "NTS_CENSUS_MIN_AVAILABLE_GB", "NTS_CENSUS_RUN_MAX_BYTES",
]);
export const ENVIRONMENT_CONTEXT = "NTS_GATE_ENV_CONTEXT";
export const ENVIRONMENT_EXPERIMENT = "NTS_GATE_ENV_EXPERIMENT";

export function launcherPolicyNames(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter(name => env[name] !== undefined && !HOST.has(name) && !PARENT.has(name) && (
    name.startsWith("NTS_") || name.startsWith("CARGO_PROFILE_") || name.startsWith("CARGO_TARGET_") || EXTRA_POLICY.has(name)
  )).sort();
}

export function assertLandingEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const names = launcherPolicyNames(env);
  if (names.length) throw new Error(`launcher verdict-policy overrides are not allowed for land: ${names.join(", ")}; unset them; standalone experiments cannot serve as landing evidence`);
}

export function hostEnvironment(launcher: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const host: NodeJS.ProcessEnv = {};
  for (const name of HOST_CAPABILITIES) if (launcher[name] !== undefined) host[name] = launcher[name];
  host.HOME ??= homedir();
  host.CARGO_HOME ||= join(host.HOME, ".cargo");
  host.RUSTUP_HOME ||= join(host.HOME, ".rustup");
  return host;
}

export function reportLauncherDrops(launcher: NodeJS.ProcessEnv, write: (text: string) => void = text => process.stderr.write(text)): void {
  const names = Object.keys(launcher).filter(name => !HOST.has(name) && !PARENT.has(name) && (
    !(name in FIXED_AMBIENT) || launcher[name] !== FIXED_AMBIENT[name]
  )).sort();
  if (names.length) write(`gate: discarded launcher variable names: ${names.join(", ")}\n`);
}

export type EnvironmentReport = {
  version: 1; canonical: boolean; host: Record<string, string | null>;
  ambient: Record<string, string | null>; dropped: string[];
  experiments: { name: string; value: string }[];
};
type Context = { report: EnvironmentReport; owned: Record<string, string>; temporary:RunTemporary };
export type GateEnvironment = { env: NodeJS.ProcessEnv; report: EnvironmentReport; temporary:RunTemporary };

function strings(values: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/** `owned` is supplied by the runner's code, never copied wholesale from a launcher. */
export function gateEnvironment(
  launcher: NodeJS.ProcessEnv,
  options: { run: string; owned?: NodeJS.ProcessEnv; standalone?: boolean; experiment?: string },
): GateEnvironment {
  const inherited = launcher[ENVIRONMENT_CONTEXT];
  let prior: Context | undefined;
  if (inherited) {
    prior = JSON.parse(inherited) as Context;
    if (prior.report?.version !== 1 || !prior.owned || typeof prior.report.canonical !== "boolean") throw new Error("invalid gate environment handoff");
  }
  const owned: Record<string,string> = { ...prior?.owned, ...strings(options.owned ?? {}), NTS_GATE_RUN_DIR: resolve(options.run) };
  // These markers describe a live descriptor or shell re-entry, not policy.
  // pinned.sh consumes the lock marker; a later re-entry must not revive it.
  for (const name of INFRASTRUCTURE) {
    if (name === "NTS_GATE_LOCK_FD" || name === "NTS_GATE_SCOPE_EXPECTED" || name === "NTS_GATE_SETUP_ONLY") {
      if (launcher[name] === undefined && options.owned?.[name] === undefined) delete owned[name];
    }
  }
  const selected = options.experiment ?? (!prior && options.standalone ? launcher[ENVIRONMENT_EXPERIMENT] : undefined);
  if (selected && selected !== "today") throw new Error(`unknown environment experiment: ${selected}`);
  const overrides: { name: string; value: string }[] = [];
  if (!prior && options.standalone) {
    for (const name of launcherPolicyNames(launcher)) {
      if (INFRASTRUCTURE.has(name)) { if (!(name in owned)) owned[name] = launcher[name]!; continue; }
      if (name === ENVIRONMENT_EXPERIMENT) continue;
      if (!EXPERIMENTS.has(name) && !/^CARGO_(?:PROFILE|TARGET)_/.test(name)) throw new Error(`unknown standalone policy override: ${name}`);
      overrides.push({ name, value: launcher[name]! });
      if (!(name in owned)) owned[name] = launcher[name]!;
    }
  }
  const legacy = selected === "today" || prior?.report.experiments.some(e => e.name === ENVIRONMENT_EXPERIMENT && e.value === "today");
  const host = hostEnvironment(launcher);
  const under = (root: string) => { const path = relative(root, resolve(options.run)); return path !== ".." && !path.startsWith("../") && !isAbsolute(path); };
  if (![join(homedir(),".cache"),join(host.HOME!,".cache")].some(under)) throw new Error("gate run directory must be under ~/.cache; /tmp is not a gate scratch directory");
  const ambient: Record<string, string | null> = {};
  for (const name of [...Object.keys(FIXED_AMBIENT), ...UNSET_AMBIENT]) {
    ambient[name] = legacy ? launcher[name] ?? null : FIXED_AMBIENT[name] ?? null;
  }
  const env: NodeJS.ProcessEnv = legacy ? { ...launcher } : { ...host };
  for (const [name, value] of Object.entries(ambient)) {
    if (value === null) delete env[name]; else env[name] = value;
  }
  Object.assign(env, owned);
  // /tmp is a small tmpfs. Neither a launcher nor an experiment owns this path.
  env.TMPDIR = join(resolve(options.run), "tmp");
  env.XDG_CACHE_HOME = join(host.HOME!, ".cache");
  ambient.TMPDIR = env.TMPDIR;
  ambient.XDG_CACHE_HOME = env.XDG_CACHE_HOME;
  if (!prior) pruneRunTemporaries(host.HOME!);
  const temporary=captureRunTemporary(options.run,prior?.temporary);
  const experiments = [...(prior?.report.experiments ?? []), ...overrides];
  if (selected === "today") experiments.push({ name: ENVIRONMENT_EXPERIMENT, value: "today" });
  delete env[ENVIRONMENT_EXPERIMENT];
  const retained = new Set<string>([...HOST_CAPABILITIES, ...Object.keys(owned), ENVIRONMENT_CONTEXT]);
  const dropped = [...new Set([...(prior?.report.dropped ?? []), ...Object.keys(launcher).filter(name =>
    !retained.has(name) && launcher[name] !== env[name]
  )])].sort();
  const report: EnvironmentReport = {
    version: 1, canonical: (prior?.report.canonical ?? true) && experiments.length === 0,
    host: Object.fromEntries(HOST_CAPABILITIES.map(name => [name, env[name] ?? null])),
    ambient, dropped, experiments,
  };
  env[ENVIRONMENT_CONTEXT] = JSON.stringify({ report, owned, temporary } satisfies Context);
  return { env, report, temporary };
}

export function reportEnvironment(report: EnvironmentReport, write: (text: string) => void = text => process.stderr.write(text)): void {
  if (report.dropped.length) write(`gate: discarded launcher variable names: ${report.dropped.join(", ")}\n`);
  if (!report.canonical) write(`gate: NON-CANONICAL experiment; not landing evidence (${report.experiments.map(e => e.name).join(", ")})\n`);
}

export function nodeHeapOomReason(text: string): string | null {
  return /JavaScript heap out of memory|Fatal process out of memory|v8::(?:internal::)?(?:V8::)?FatalProcessOutOfMemory|FATAL ERROR: (?:Reached heap limit|Ineffective mark-compacts)/i.test(text)
    ? "Node/V8 heap out of memory diagnostic" : null;
}

// The shell re-enters only after this helper has normalized its initial build
// environment, so pinned.sh's Cargo invocation has the same contract as steps.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [mode, script, ...args] = process.argv.slice(2);
    if (mode !== "--pinned" || !script) throw new Error("usage: canonical-environment.ts --pinned <script> [commit] [steps...]");
    const base = process.env;
    if (base.NTS_GATE_STEP && base[ENVIRONMENT_CONTEXT]) throw new Error("nested pinned gate entry must use its own run directory and environment");
    const home = base.HOME ?? homedir();
    const run = base.NTS_GATE_RUN_DIR ?? join(home, ".cache/nts-gate/runs", `${Date.now()}-${process.pid}`);
    const target = base.NTS_GATE_TARGET ?? join(home, ".cache/nts-gate/target");
    const owned: NodeJS.ProcessEnv = {
      NTS_GATE_TREE: base.NTS_GATE_TREE ?? join(home, ".cache/nts-gate/tree"), NTS_GATE_TARGET: target,
      CARGO_TARGET_DIR: target, NTS_BIN: join(target, "release/nts"), NTS_SUITE_BIN: join(target, "release/nts-suite"), NTS_CHECKERS: "1",
    };
    for (const name of INFRASTRUCTURE) if (base[name] !== undefined) owned[name] = base[name];
    const planned = gateEnvironment(base, { run, owned, standalone: !base[ENVIRONMENT_CONTEXT] });
    reportEnvironment(planned.report);
    const result = spawnSync("sh", [script, "--environment-ready", ...args], {
      env: planned.env,
      // Preserve only the documented gate-tree lock handoff, not arbitrary
      // inherited descriptors. Its inode/ownership is checked by pinned.sh.
      stdio: base.NTS_GATE_LOCK_FD === "8" ? ["inherit", "inherit", "inherit", "ignore", "ignore", "ignore", "ignore", "ignore", 8] : "inherit",
    });
    // Setup-only success and failures before run.mjs still own a temporary
    // root. Normal row completion already records its lifecycle in summary.
    if (!existsSync(join(run,"summary.json"))) {
      const outcome=finishRunTemporary(planned.temporary,planned.env.HOME!,result.status===0 && !result.signal && !result.error);
      process.stderr.write(`gate tmp: ${outcome.state}: ${outcome.path}\n`);
    }
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) { console.error(`gate environment: ${(error as Error).message}`); process.exitCode = 2; }
}
