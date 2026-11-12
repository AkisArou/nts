// One environment contract for landing, pinned and full gates. A launcher is
// not allowed to choose verdict policy; standalone experiments are explicit.
import { createHash } from "node:crypto";
import { existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { delimiter,dirname,join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import {dependencyCapability,sealDependencyCapability,ToolingInstrumentError,CaseBudgetError} from "../differential/oracle-dependencies.ts";
import {assertRunTemporary,captureRunTemporary,pruneRunTemporaries,finishRunTemporary,type RunTemporary} from "./run-temporary.ts";
import {nodeProcessBirth,nodeProcessAlive,nodeResolutionOptions} from '../differential/oracle-runtime.ts';

import {hostObservations,HOST_OBSERVATION_ENVIRONMENT} from './host-observations.ts';
import {startNodeResolutionSession} from '../differential/oracle-resolution.ts';
import {CONTENT_CACHE_ENVIRONMENT,FIXTURE_ENVIRONMENT,cacheLocation} from './cache-environment.ts';
import {toolchainDirectories} from './toolchain.ts';

import {HOST_INFRASTRUCTURE} from "./host-infrastructure.ts";
export {HOST_INFRASTRUCTURE} from "./host-infrastructure.ts";
export const HOST_CAPABILITIES = [
  "PATH", "HOME", ...HOST_INFRASTRUCTURE, "CARGO_HOME", "RUSTUP_HOME",
  "JAVA_HOME", "JDK_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_AVD_HOME", "DEBUGINFOD_URLS",
  "CC", "CXX", "RUSTC", "RUSTDOC", "NTS_LLVM_CC", "NTS_LLVM_AS", "NTS_BIND_CC",
  "GI_GIR_PATH", "XDG_DATA_DIRS", "NTS_NAPI_INCLUDE", "NTS_APPLE_ROOT", "NTS_APPLE_SDK",
  "NTS_ORACLE_TYPESCRIPT", "NTS_ORACLE_DEPENDENCIES",
  "NTS_IOS_SIMULATOR_SDK", "NTS_WINDOWS_ROOT", "NTS_WIN32_WINMD", "NTS_WINRT_METADATA",
  "NTS_APPLE_SSH", "NTS_WINDOWS_SSH", "NTS_IOS_DEVICE", "SSH_AUTH_SOCK",
] as const;

export const FIXED_AMBIENT: Readonly<Record<string, string>> = {
  LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", FORCE_COLOR: "0", TERM: "dumb",
  GIT_OPTIONAL_LOCKS: "0",
};
const SYSTEM_TOOL_DIRECTORIES = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/local/sbin", "/usr/sbin", "/sbin"];
export const UNSET_AMBIENT = [
  "RAYON_NUM_THREADS",
  "LANGUAGE", "NODE_OPTIONS", "NODE_PATH", "NODE_ICU_DATA", "NODE_PENDING_DEPRECATION",
  "NODE_REPL_EXTERNAL_MODULE", "NODE_NO_WARNINGS", "NODE_ENV", "NODE_TEST_CONTEXT", "NO_COLOR",
  "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "JDK_JAVAC_OPTIONS", "_JAVA_OPTIONS", "JAVA_OPTS", "JVM_OPTS", "CLASSPATH",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH",
  "CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS", "CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "LIBRARY_PATH",
  // Every audited GTK/Chromium gate path starts its own Xvfb and assigns DISPLAY.
  "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY",
] as const;

// A step's handoff from its run, not capabilities forwarded to programs under
// test: the slice it runs in, and the memory reservation it runs inside
// (memory-ledger.ts), which a tool in the step joins instead of asking again.
const PARENT = new Set(["NTS_TOOLING_SLICE", "NTS_MEMORY_RESERVATION"]);
// Owned values a launcher's code supplies, never copied from the launcher:
// the run's place in the machine's memory queue (landing, agent, full-check),
// which a shell's own value would otherwise let it jump, and a reservation
// the run takes over (the landing build's, memory-ledger.ts's `replaces`),
// which a shell's would let it end. A shell's is discarded, and named as
// discarded.
const CODE_OWNED = new Set(["NTS_MEMORY_PRIORITY", "NTS_MEMORY_HANDOVER"]);
// Handoffs one process consumes, not policy: a live descriptor, a shell
// re-entry, a reservation to take over. pinned.sh consumes the lock marker,
// the runner the reservation; a later re-entry, whose launcher no longer
// carries one, must not revive it from the context it inherits.
const CONSUMED = ["NTS_GATE_LOCK_FD", "NTS_GATE_SCOPE_EXPECTED", "NTS_GATE_SETUP_ONLY", "NTS_MEMORY_HANDOVER"] as const;
const HOST = new Set<string>(HOST_CAPABILITIES);
const EXTRA_POLICY = new Set([
  "RAYON_NUM_THREADS",
  "CARGO_INCREMENTAL", "CARGO_BUILD_JOBS", "CARGO_BUILD_TARGET", "CARGO_TARGET_DIR",
  "CARGO_ENCODED_RUSTFLAGS", "CARGO_ENCODED_RUSTDOCFLAGS", "RUSTFLAGS", "RUSTDOCFLAGS",
  "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "RUSTC_BOOTSTRAP", "RUSTUP_TOOLCHAIN", "RUST_TEST_THREADS",
]);
const INFRASTRUCTURE = new Set([
  "NTS_GATE_TREE", "NTS_GATE_TARGET", "NTS_GATE_RUN_DIR", "NTS_GATE_SETUP_ONLY",
  "NTS_GATE_LOCK_FD", "NTS_GATE_SCOPE_EXPECTED",
  "NTS_GATE_CASE_LEASE_ADDRESS", "NTS_GATE_CASE_LEASE_ID",
  "NTS_GATE_COMPILER_OBSERVATION",
]);
const EXPERIMENTS = new Set([
  ...CONTENT_CACHE_ENVIRONMENT,FIXTURE_ENVIRONMENT,
  ...EXTRA_POLICY, "NTS_GATE_STEPS", "NTS_GATE_SLOTS", "NTS_GATE_JOBS", "NTS_JOBS",
  "NTS_GATE_FRONTENDS", "NTS_GATE_FAIL_FAST", "NTS_GATE_ACCEPT_SKIP", "NTS_GATE_TIME_STRICT", "NTS_GATE_RECORD_TIMES",
  // The landing check's ceiling on step bounds (step-bound.ts), owned by it.
  "NTS_GATE_STEP_CEILING_S",
  "NTS_BIN", "NTS_SUITE_BIN", "NTS_CHECKERS", "NTS_INTEROP_PROJECTS", "NTS_DOCTEST_CRATES", "NTS_COREDUMPS",
  "NTS_RC_NAIVE", "NTS_DEX_METHOD_FLOOR", "NTS_BACKEND", "NTS_RC", "NTS_POISON", "NTS_SANITIZE",
  "NTS_KEEP_TEMP", "NTS_TRACE_LOWERING", "NTS_ARRIVALS", "NTS_DIFF_OBJECT_CACHE", "NTS_DIFF_NO_OBJECT_CACHE",
  "NTS_CENSUS_MEMORY_CAP_KB", "NTS_CENSUS_RUN_MAX_BYTES",
  // The memory reading admission decides by, and the paging reading a census
  // judges a degraded machine by (conformance262.ts), the memory ledger a run
  // queues in (memory-ledger.ts), and the history its steps are sized by
  // (step-scheduling.ts). A test gives its inner runs owned ones, so the
  // host's memory, the machine's queue and the tree's peaks never decide it;
  // set by a launcher, any of them makes the run an experiment.
  ...HOST_OBSERVATION_ENVIRONMENT,
]);
import {ENVIRONMENT_CONTEXT,assertSealedOracleRun} from '../differential/oracle-seal.ts';
export {ENVIRONMENT_CONTEXT} from '../differential/oracle-seal.ts';
export const ENVIRONMENT_EXPERIMENT = "NTS_GATE_ENV_EXPERIMENT";
export function nodeCompileCacheRoot(env:NodeJS.ProcessEnv=process.env):string{
  return cacheLocation('NODE_COMPILE_CACHE',env[FIXTURE_ENVIRONMENT]!==undefined?env:{},()=>join(userInfo().homedir,'.cache/nts/node-compile-cache/v1'));
}

/** Storage is owned by the caller's lifetime; shell cache overrides choose neither path. */
export function ownedCacheEnvironment(launcher:NodeJS.ProcessEnv,options:{temporary:string}):{TMPDIR:string;NODE_COMPILE_CACHE:string} {
  try {
    const cache=nodeCompileCacheRoot(launcher);
    const temporary=options.temporary,home=hostEnvironment(launcher).HOME!;
    const under=(root:string,path:string)=>{const part=relative(root,path);return part!==""&&part!==".."&&!part.startsWith("../")&&!isAbsolute(part);};
    const roots=[join(userInfo().homedir,".cache"),join(home,".cache")];
    if(typeof temporary!=="string"||!isAbsolute(temporary)||roots.some(root=>resolve(root)===resolve(temporary))||!roots.some(root=>under(root,temporary)))throw new Error(`not an absolute home-cache path: ${String(temporary)}`);
    const stat=lstatSync(temporary);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.())throw new Error(`not an owned real directory: ${temporary}`);
    const actual=realpathSync(temporary);
    if(roots.some(root=>existsSync(root)&&realpathSync(root)===actual)||!roots.some(root=>existsSync(root)&&under(realpathSync(root),actual)))throw new Error(`directory escapes the home cache: ${temporary}`);
    if(launcher[ENVIRONMENT_CONTEXT]){
      const context=JSON.parse(launcher[ENVIRONMENT_CONTEXT]) as Context;
      if(context.report?.version!==1||!context.owned||typeof context.report.canonical!=="boolean")throw new Error("invalid canonical handoff");
      assertRunTemporary(context.temporary,home);
      if(launcher.TMPDIR!==context.temporary.path)throw new Error("canonical TMPDIR differs from its registered temporary");
    }
    return {TMPDIR:temporary,NODE_COMPILE_CACHE:cache};
  }catch(error){throw new Error(`owned Node cache temporary: ${(error as Error).message}`);}
}

/**
 * Gives this process `<run>/tmp` as the temporary its children write to, and
 * returns it. In a canonical context it is registered there as well, as a
 * temporary of the run's own nested in the one the context registered (a job's
 * inside its run's: run-temporary.ts's `enclosing`). TMPDIR and the context
 * then agree by construction, so `ownedCacheEnvironment` holds in every child.
 * A temporary outside the context's is refused. Outside a canonical context
 * only TMPDIR changes.
 */
export function ownTemporary(run:string,env:NodeJS.ProcessEnv=process.env):string {
  const raw=env[ENVIRONMENT_CONTEXT];
  if(!raw){
    const path=join(resolve(run),"tmp");
    mkdirSync(path,{recursive:true});
    env.TMPDIR=path;
    return path;
  }
  // The context's TMPDIR is its registered temporary before this one nests in it.
  ownedCacheEnvironment(env,{temporary:env.TMPDIR!});
  const context=JSON.parse(raw) as Context;
  const temporary=captureRunTemporary(run,context.temporary);
  if(temporary.path!==context.temporary.path&&!temporary.enclosing)
    throw new Error(`a temporary of its own: ${temporary.path} is outside its run's registered temporary ${context.temporary.path}`);
  const storage=ownedCacheEnvironment(env,{temporary:temporary.path});
  const report={...context.report,ambient:{...context.report.ambient,TMPDIR:storage.TMPDIR}};
  Object.assign(env,storage);
  env[ENVIRONMENT_CONTEXT]=JSON.stringify({...context,report,temporary} satisfies Context);
  return storage.TMPDIR;
}

/**
 * A temporary of its own for a child, and the child's environment, made from
 * `env`, which is left as it was. In a canonical context it is a new folder in
 * the context's registered temporary, registered there (`ownTemporary`), so
 * the child's TMPDIR and context agree by construction; outside one, a new
 * folder under `outside`, and only TMPDIR changes. `dir` is the folder; the
 * child writes in `dir/tmp`. This is the one way a tool gives a child a
 * TMPDIR of its own.
 */
export function childTemporary(env:NodeJS.ProcessEnv,outside:string,prefix:string):{env:NodeJS.ProcessEnv;dir:string} {
  const base=env[ENVIRONMENT_CONTEXT]?env.TMPDIR:outside;
  if(!base)throw new Error("a canonical context names no TMPDIR to make a child's temporary in");
  mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,prefix)),child={...env};
  ownTemporary(dir,child);
  return {env:child,dir};
}

export function launcherPolicyNames(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter(name => env[name] !== undefined && !HOST.has(name) && !PARENT.has(name) && !CODE_OWNED.has(name) && (
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
  host.HOME ||= userInfo().homedir;
  host.CARGO_HOME ||= join(host.HOME, ".cargo");
  host.RUSTUP_HOME ||= join(host.HOME, ".rustup");
  return host;
}

/** The tooling tree's provisioned package, never an application's or PATH's. */
export function oracleToolchainLocation():string {
  return dirname(realpathSync(join(resolve(dirname(fileURLToPath(import.meta.url)),"../.."),"node_modules/typescript/package.json")));
}

/** A synthetic tooling tree may omit this capability; declaring it is binding. */
export function declaredOracleToolchain(root=resolve(dirname(fileURLToPath(import.meta.url)),"../..")):string|undefined {
  const manifest=join(root,"package.json");
  if(!existsSync(manifest))return undefined;
  const pkg=JSON.parse(readFileSync(manifest,"utf8"));
  if(![pkg.dependencies,pkg.devDependencies,pkg.optionalDependencies].some(dependencies=>dependencies?.typescript!==undefined))return undefined;
  try{return dirname(realpathSync(join(root,"node_modules/typescript/package.json")));}
  catch(error){throw new Error(`declared oracle TypeScript capability is missing from ${root}: ${String(error)}`);}
}

/** Bus locations authorize orchestration; they do not identify program inputs. */
export function programHost(host: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(host ?? {}).filter(([name]) => !(HOST_INFRASTRUCTURE as readonly string[]).includes(name)));
}

/** Only counted compiler invocations use upstream's fixed Rayon setting. */
export function measuredCompileEnvironment(base:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  return {...base,...FIXED_AMBIENT,RAYON_NUM_THREADS:"1"};
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
type Context = { report: EnvironmentReport; owned: Record<string, string>; temporary:RunTemporary;resolutionOwner?:{pid:number;birth:string} };
export type {Context as GateEnvironmentContext};
export type GateEnvironment = { env: NodeJS.ProcessEnv; report: EnvironmentReport; temporary:RunTemporary };

/** The runner binds telemetry ownership before launching a step. Children
 * retain it through the existing capability, independently of mock step names. */
export function oracleStepEnvironment(env:NodeJS.ProcessEnv,step:string):NodeJS.ProcessEnv {
  if(!/^[a-z][a-z0-9-]*$/.test(step))throw new Error('invalid oracle capture owner step');
  const context:Context=JSON.parse(env[ENVIRONMENT_CONTEXT]??'null');
  if(context?.report?.version!==1||!context.owned)throw new Error('missing canonical oracle step context');
  const raw=context.owned.NTS_ORACLE_DEPENDENCIES;if(!raw)return env;
  if(env.NTS_ORACLE_DEPENDENCIES!==raw||context.report.host.NTS_ORACLE_DEPENDENCIES!==raw)throw new Error('invalid owned oracle dependency handoff');
  const next=JSON.stringify({...JSON.parse(raw),ownerStep:step});
  context.owned.NTS_ORACLE_DEPENDENCIES=next;context.report.host.NTS_ORACLE_DEPENDENCIES=next;
  return {...env,NTS_ORACLE_DEPENDENCIES:next,[ENVIRONMENT_CONTEXT]:JSON.stringify(context)};
}

function strings(values: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/** `owned` is supplied by the runner's code, never copied wholesale from a launcher. */
export function gateEnvironment(
  launcher: NodeJS.ProcessEnv,
  options: { run: string; owned?: NodeJS.ProcessEnv; standalone?: boolean; experiment?: string; oracleAdmissionContext?: "gate" | "standalone"; oracleRoot?: string; node?: string },
): GateEnvironment {
  const inherited = launcher[ENVIRONMENT_CONTEXT];
  let prior: Context | undefined;
  if (inherited) {
    prior = JSON.parse(inherited) as Context;
    if (prior.report?.version !== 1 || !prior.owned || typeof prior.report.canonical !== "boolean") throw new Error("invalid gate environment handoff");
  }
  const owned: Record<string,string> = { ...prior?.owned, ...strings(options.owned ?? {}), NTS_GATE_RUN_DIR: resolve(options.run) };
  for (const name of CONSUMED) {
    if (launcher[name] === undefined && options.owned?.[name] === undefined) delete owned[name];
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
  // The enclosing context retains its resolved tools and source-owned fixture
  // overrides. A fresh canonical run resolves its selected Node and declared
  // toolchains ahead of the fixed system directories.
  if (!legacy && owned.PATH === undefined) {
    owned.PATH = [...new Set([...toolchainDirectories(options.node ?? process.execPath, host), ...SYSTEM_TOOL_DIRECTORIES])].join(delimiter);
  }
  delete host.NTS_ORACLE_DEPENDENCIES;delete owned.NTS_ORACLE_DEPENDENCIES;
  const toolingRoot=realpathSync(options.oracleRoot??resolve(dirname(fileURLToPath(import.meta.url)),"../.."));
  const inheritedDependencies=prior?.owned.NTS_ORACLE_DEPENDENCIES;
  if(inheritedDependencies&&prior!.report.host.NTS_ORACLE_DEPENDENCIES!==inheritedDependencies)throw new Error("invalid owned oracle dependency handoff");
  const inheritedCapability=inheritedDependencies?JSON.parse(inheritedDependencies):undefined;
  if(inheritedCapability&&(inheritedCapability.version!==1||typeof inheritedCapability.source!=="string"||!isAbsolute(inheritedCapability.source)))throw new Error("invalid owned oracle dependency handoff");
  if(inheritedCapability&&inheritedCapability.admission?.kind!=="gate"&&inheritedCapability.admission?.kind!=="standalone")throw new Error("invalid owned oracle admission handoff");
  // Only source-owned callers choose a new oracle root. A foreign grant is
  // unused authority, never proof for this tree; policy and temporary stay.
  const foreignRoot=Boolean(options.oracleRoot!==undefined&&inheritedCapability&&inheritedCapability.source!==toolingRoot);
  // A launcher/application path never selects the oracle. Only the tooling
  // manifest or an already owned canonical handoff supplies this capability.
  const inheritedOracle=prior?.owned.NTS_ORACLE_TYPESCRIPT;
  if(inheritedOracle&&prior!.report.host.NTS_ORACLE_TYPESCRIPT!==inheritedOracle)throw new Error("invalid owned oracle TypeScript handoff");
  const oracle=inheritedOracle&&options.oracleRoot===undefined?dirname(realpathSync(join(inheritedOracle,"package.json"))):declaredOracleToolchain(toolingRoot);
  delete host.NTS_ORACLE_TYPESCRIPT;delete owned.NTS_ORACLE_TYPESCRIPT;
  if(oracle){host.NTS_ORACLE_TYPESCRIPT=oracle;owned.NTS_ORACLE_TYPESCRIPT=oracle;}
  const under = (root: string) => { const path = relative(root, resolve(options.run)); return path !== ".." && !path.startsWith("../") && !isAbsolute(path); };
  if (![join(userInfo().homedir,".cache"),join(host.HOME!,".cache")].some(under)) throw new Error("gate run directory must be under ~/.cache; /tmp is not a gate scratch directory");
  const ambient: Record<string, string | null> = {};
  for (const name of [...Object.keys(FIXED_AMBIENT), ...UNSET_AMBIENT]) {
    ambient[name] = legacy ? launcher[name] ?? null : FIXED_AMBIENT[name] ?? null;
  }
  const env: NodeJS.ProcessEnv = legacy ? { ...launcher } : { ...host };
  for (const name of CODE_OWNED) delete env[name];
  for (const [name, value] of Object.entries(ambient)) {
    if (value === null) delete env[name]; else env[name] = value;
  }
  Object.assign(env, owned);
  if(oracle)env.NTS_ORACLE_TYPESCRIPT=oracle;else delete env.NTS_ORACLE_TYPESCRIPT;
  if (!prior) pruneRunTemporaries(host.HOME!,{host:hostObservations(env)});
  const temporary=captureRunTemporary(options.run,prior?.temporary);
  // /tmp is a small tmpfs. Neither a launcher nor an experiment owns these paths.
  const storage=ownedCacheEnvironment(launcher,{temporary:temporary.path});
  Object.assign(env,storage);
  owned.NODE_COMPILE_CACHE=storage.NODE_COMPILE_CACHE;
  env.XDG_CACHE_HOME = join(host.HOME!, ".cache");
  ambient.TMPDIR = storage.TMPDIR;
  ambient.NODE_COMPILE_CACHE=storage.NODE_COMPILE_CACHE;
  ambient.XDG_CACHE_HOME = env.XDG_CACHE_HOME;
  const experiments = [...(prior?.report.experiments ?? []), ...overrides];
  if (selected === "today") experiments.push({ name: ENVIRONMENT_EXPERIMENT, value: "today" });
  delete env[ENVIRONMENT_EXPERIMENT];
  const retained = new Set<string>([...HOST_CAPABILITIES, ...Object.keys(owned), ENVIRONMENT_CONTEXT]);
  const dropped = [...new Set([...(prior?.report.dropped ?? []), ...Object.keys(launcher).filter(name =>
    !retained.has(name) && launcher[name] !== env[name]
  ), ...(launcher.PATH !== env.PATH ? ["PATH"] : [])])].sort();
  if(options.oracleAdmissionContext!==undefined&&options.oracleAdmissionContext!=="gate"&&options.oracleAdmissionContext!=="standalone")throw new Error("invalid oracle admission context");
  const admissionKind=options.oracleAdmissionContext??inheritedCapability?.admission.kind??"standalone";
  // An inherited capability keeps its capture root. Only an explicit caller
  // can change its policy, and a gate grant binds that registered temporary.
  const admission=admissionKind==="gate"?{kind:"gate" as const,temporary:inheritedCapability?.admission.kind==="gate"?inheritedCapability.admission.temporary:prior?.temporary??temporary}:{kind:"standalone" as const};
  // A sealed parent image may already occupy the default directory. Keep it
  // intact while the candidate independently captures and seals its own root.
  const capture=join(temporary.path,"oracle-dependencies",...(foreignRoot?["source-"+createHash("sha256").update(toolingRoot).digest("hex")]:[]));
  const dependencies=inheritedCapability&&!foreignRoot?JSON.stringify({...inheritedCapability,admission}):(oracle&&existsSync(join(toolingRoot,"pnpm-lock.yaml"))?
    JSON.stringify(dependencyCapability(toolingRoot,capture,admission,null,env)):undefined);
  if(dependencies){env.NTS_ORACLE_DEPENDENCIES=dependencies;owned.NTS_ORACLE_DEPENDENCIES=dependencies;}
  const report: EnvironmentReport = {
    version: 1, canonical: (prior?.report.canonical ?? true) && experiments.length === 0,
    host: Object.fromEntries(HOST_CAPABILITIES.map(name => [name, env[name] ?? null])),
    ambient, dropped, experiments,
  };
  const resolutionOwner=process.platform==='linux'?(prior?.resolutionOwner??{pid:process.pid,birth:nodeProcessBirth(process.pid)}):undefined;
  if(resolutionOwner&&!nodeProcessAlive(resolutionOwner))throw new Error('oracle resolution run owner changed');
  env[ENVIRONMENT_CONTEXT] = JSON.stringify({ report, owned, temporary,...(resolutionOwner?{resolutionOwner}:{}) } satisfies Context);
  return { env, report, temporary };
}

/** Keep classification at the launcher boundary, not in the node-only leaf. */
export function requireSealedOracleRun(env:NodeJS.ProcessEnv):void{
  try{assertSealedOracleRun(env);}
  catch(error){throw new ToolingInstrumentError('tooling-setup',error instanceof Error?error.message:String(error),{cause:error});}
}

/** Validate once in the run parent, then forward its exact pinned seal. */
export async function sealOracleRun(planned:GateEnvironment,signal?:AbortSignal):Promise<GateEnvironment>{
  const raw=planned.env.NTS_ORACLE_DEPENDENCIES;if(!raw)return planned;
  const context:Context=JSON.parse(planned.env[ENVIRONMENT_CONTEXT]??'null');
  if(context?.report?.version!==1||context.owned?.NTS_ORACLE_DEPENDENCIES!==raw||context.report.host.NTS_ORACLE_DEPENDENCIES!==raw)throw new Error('invalid owned oracle dependency run');
  let cap;try{
    cap=await sealDependencyCapability(JSON.parse(raw),planned.env,signal);
    signal?.throwIfAborted();
    if(process.platform==='linux'){
      context.resolutionOwner??={pid:process.pid,birth:nodeProcessBirth(process.pid)};
      if(!nodeProcessAlive(context.resolutionOwner))throw new Error('oracle resolution run owner changed');
      const execution=JSON.parse(readFileSync(new URL('../differential/oracle-toolchain.json',import.meta.url),'utf8')).execution.args as string[];
      const bootstrap=execution.find((_argument,index)=>index>0&&execution[index-1]==='--import');
      await startNodeResolutionSession(join(cap.directory,'oracle-resolution','node-'+process.versions.node),nodeResolutionOptions(execution,planned.env,bootstrap),context.resolutionOwner.pid);
    }
  }catch(error){if(error instanceof CaseBudgetError)throw error;throw new ToolingInstrumentError('tooling-setup',String(error));}
  const next=JSON.stringify(cap);
  const report={...planned.report,host:{...planned.report.host,NTS_ORACLE_DEPENDENCIES:next}};
  const owned={...context.owned,NTS_ORACLE_DEPENDENCIES:next};
  return {...planned,report,env:{...planned.env,NTS_ORACLE_DEPENDENCIES:next,[ENVIRONMENT_CONTEXT]:JSON.stringify({...context,report,owned})}};
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
    const home = base.HOME || userInfo().homedir;
    const run = base.NTS_GATE_RUN_DIR ?? join(home, ".cache/nts-gate/runs", `${Date.now()}-${process.pid}`);
    const target = base.NTS_GATE_TARGET ?? join(home, ".cache/nts-gate/target");
    const owned: NodeJS.ProcessEnv = {
      NTS_GATE_TREE: base.NTS_GATE_TREE ?? join(home, ".cache/nts-gate/tree"), NTS_GATE_TARGET: target,
      CARGO_TARGET_DIR: target, NTS_BIN: join(target, "release/nts"), NTS_SUITE_BIN: join(target, "release/nts-suite"), NTS_CHECKERS: "1",
    };
    for (const name of INFRASTRUCTURE) if (base[name] !== undefined) owned[name] = base[name];
    const planned = gateEnvironment(base, { run, owned, standalone: !base[ENVIRONMENT_CONTEXT], oracleAdmissionContext: "gate" });
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
      const outcome=finishRunTemporary(planned.temporary,planned.env.HOME!,result.status===0 && !result.signal && !result.error,{host:hostObservations(planned.env)});
      process.stderr.write(`gate tmp: ${outcome.state}: ${outcome.path}\n`);
    }
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) { console.error(`gate environment: ${(error as Error).message}`); process.exitCode = 2; }
}
