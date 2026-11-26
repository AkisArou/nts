// One environment contract for landing, pinned and full gates. A launcher is
// not allowed to choose verdict policy; standalone experiments are explicit.
import {ownRunTemporary} from './run-temporary-lifetime.ts';
import { createHash } from "node:crypto";
import { existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { spawn,spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { delimiter,dirname,join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import {dependencyCapability,sealDependencyCapability,ToolingInstrumentError,CaseBudgetError} from "../differential/oracle-dependencies.ts";
import {captureRunTemporary,pruneRunTemporaries,runTemporaryIdentity,discardRunTemporary,removable,assertRunTemporary,assertRunTemporaryOpen} from "./run-temporary.ts";
import {nodeProcessBirth,nodeResolutionDirectory,nodeResolutionOptions} from '../differential/oracle-runtime.ts';

import {hostObservations,HOST_OBSERVATIONS,HOST_OBSERVATION_ENVIRONMENT} from './host-observations.ts';
import {startNodeResolutionSession,closeNodeResolutionSession} from '../differential/oracle-resolution.ts';
import {assertSealedOracleRun} from '../differential/oracle-seal/main.ts';
import {exitCommand,isCommandExit,registerCommandCloser} from '../differential/command-entry/main.ts';
import type {NodeResolutionSession} from '../differential/oracle-runtime.ts';
import type {JobRequest} from './memory-ledger.ts';
import {HOST_CAPABILITIES,FIXED_AMBIENT,UNSET_AMBIENT,ownedCacheEnvironment,hostEnvironment,declaredOracleToolchain} from './host-environment.ts';
import type {Context,EnvironmentReport,GateEnvironment} from './environment-types.ts';
import {CONTENT_CACHE_ENVIRONMENT,FIXTURE_ENVIRONMENT} from './cache-environment.ts';
import {assignOwnedValues} from './environment-values.ts';
import {toolchainDirectories} from './toolchain.ts';
import {chooseJdk} from './jdk.ts';

const SYSTEM_TOOL_DIRECTORIES = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/local/sbin", "/usr/sbin", "/sbin"];
// A step's handoff from its run, not capabilities forwarded to programs under
// test: the slice it runs in, and the memory reservation it runs inside
// (memory-ledger.ts), which a tool in the step joins instead of asking again.
const PARENT = new Set(["NTS_TOOLING_SLICE", "NTS_MEMORY_RESERVATION"]);
// Owned values a launcher's code supplies, never copied from the launcher:
// the run's place in the machine's memory queue (a rank of ranks.ts's),
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
  "NTS_GATE_CHECK_CHANNEL", "NTS_GATE_CHECK_CAPABILITY",
  "NTS_RUST_INPUT_TRACE",
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
import {ENVIRONMENT_CONTEXT} from '../differential/oracle-seal/main.ts';
export const ENVIRONMENT_EXPERIMENT = "NTS_GATE_ENV_EXPERIMENT";
export function launcherPolicyNames(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter(name => env[name] !== undefined && !HOST.has(name) && !PARENT.has(name) && !CODE_OWNED.has(name) && (
    name.startsWith("NTS_") || name.startsWith("CARGO_PROFILE_") || name.startsWith("CARGO_TARGET_") || EXTRA_POLICY.has(name)
  )).sort();
}

export function assertLandingEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const names = launcherPolicyNames(env);
  if (names.length) throw new Error(`launcher verdict-policy overrides are not allowed for land: ${names.join(", ")}; unset them; standalone experiments cannot serve as landing evidence`);
}

export function reportLauncherDrops(launcher: NodeJS.ProcessEnv, write: (text: string) => void = text => process.stderr.write(text)): void {
  const names = Object.keys(launcher).filter(name => !HOST.has(name) && !PARENT.has(name) && (
    !(name in FIXED_AMBIENT) || launcher[name] !== FIXED_AMBIENT[name]
  )).sort();
  if (names.length) write(`gate: discarded launcher variable names: ${names.join(", ")}\n`);
}

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
  options: { run: string; owned?: NodeJS.ProcessEnv; standalone?: boolean; experiment?: string; oracleAdmissionContext?: "gate" | "standalone"; oracleRoot?: string; node?: string; jdkInstallations?: string[] },
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
  // A fixture's memory priority orders only its own ledger. Without a slice
  // of its own, its run's slices become rank roots under nts.slice at that
  // rank's real CPU weight: full-check's starved a fixture on a busy machine.
  if (owned[HOST_OBSERVATIONS] !== undefined && owned.NTS_MEMORY_PRIORITY !== undefined && owned.NTS_TOOLING_SLICE === undefined) {
    throw new Error(`gate environment: a fixture's owned NTS_MEMORY_PRIORITY=${owned.NTS_MEMORY_PRIORITY} needs an owned NTS_TOOLING_SLICE to run in; without one its run's slices take that rank's CPU weight among every rank's work`);
  }
  const selected = options.experiment ?? (!prior && options.standalone ? launcher[ENVIRONMENT_EXPERIMENT] : undefined);
  if (selected && selected !== "today") throw new Error(`unknown environment experiment: ${selected}`);
  const overrides: { name: string; value: string }[] = [];
  if (!prior && options.standalone) {
    for (const name of launcherPolicyNames(launcher)) {
      if (INFRASTRUCTURE.has(name)) { if (!(name in owned)) owned[name] = launcher[name]!; continue; }
      if (name === ENVIRONMENT_EXPERIMENT) continue;
      if (!EXPERIMENTS.has(name) && !/^CARGO_(?:PROFILE|TARGET)_/.test(name) && options.owned?.[name]!==launcher[name]) throw new Error(`unknown standalone policy override: ${name}`);
      overrides.push({ name, value: launcher[name]! });
      if (!(name in owned)) owned[name] = launcher[name]!;
    }
  }
  const legacy = selected === "today" || prior?.report.experiments.some(e => e.name === ENVIRONMENT_EXPERIMENT && e.value === "today");
  const host = hostEnvironment(launcher);
  const toolingRoot=realpathSync(options.oracleRoot??resolve(dirname(fileURLToPath(import.meta.url)),"../.."));
  // The tree's declared JDK, not the launcher's JAVA_HOME (jdk.ts): the
  // runtime jar's bytes depend on which javac builds it.
  const jdk = legacy ? prior?.report.jdk : chooseJdk(host, launcher, toolingRoot, options.jdkInstallations) ?? prior?.report.jdk;
  // The enclosing context retains its resolved tools and source-owned fixture
  // overrides. A fresh canonical run resolves its selected Node and declared
  // toolchains ahead of the fixed system directories.
  if (!legacy && owned.PATH === undefined) {
    owned.PATH = [...new Set([...toolchainDirectories(options.node ?? process.execPath, host), ...SYSTEM_TOOL_DIRECTORIES])].join(delimiter);
  }
  delete host.NTS_ORACLE_DEPENDENCIES;delete owned.NTS_ORACLE_DEPENDENCIES;
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
  // Construction validates the complete named view without sampling it.
  // Keep this object through drain; cleanup must not first acquire authority.
  const observations=hostObservations(env);
  assertRunTemporaryOpen(options.run,host.HOME!);
  if (!prior) pruneRunTemporaries(host.HOME!,{host:observations});
  const temporary=captureRunTemporary(options.run,prior?.temporary,host.HOME!);
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
  const admission=admissionKind==="gate"?{kind:"gate" as const,temporary:runTemporaryIdentity(inheritedCapability?.admission.kind==="gate"?inheritedCapability.admission.temporary:prior?.temporary??temporary)}:{kind:"standalone" as const};
  // A sealed parent image may already occupy the default directory. Keep it
  // intact while the candidate independently captures and seals its own root.
  const capture=join(temporary.path,"oracle-dependencies",...(foreignRoot?["source-"+createHash("sha256").update(toolingRoot).digest("hex")]:[]));
  // Carry the candidate inside the owned handoff so an unsealed child can
  // prepare too. It grants no source authority until ordinary validation.
  const parentImage=foreignRoot&&inheritedCapability?.seal?inheritedCapability:undefined;
  if(parentImage)assertSealedOracleRun(launcher);
  const dependencies=inheritedCapability&&!foreignRoot?JSON.stringify({...inheritedCapability,admission}):(oracle&&existsSync(join(toolingRoot,"pnpm-lock.yaml"))?
    JSON.stringify({...dependencyCapability(toolingRoot,capture,admission,null,env,{owned:runTemporaryIdentity(temporary),home:host.HOME!}),...(parentImage?{parentImage}:{})}):undefined);
  if(dependencies){env.NTS_ORACLE_DEPENDENCIES=dependencies;owned.NTS_ORACLE_DEPENDENCIES=dependencies;}
  const report: EnvironmentReport = {
    version: 1, canonical: (prior?.report.canonical ?? true) && experiments.length === 0,
    host: Object.fromEntries(HOST_CAPABILITIES.map(name => [name, env[name] ?? null])),
    ambient, dropped, experiments, ...(jdk ? { jdk } : {}),
  };
  // A sealed child borrows the exact live parent session. An unsealed command
  // owns fresh mutable state even when it reuses the parent's dependency image.
  let resolutionOwner:Context['resolutionOwner'];
  if(process.platform==='linux'){
    if(inheritedCapability?.seal&&!foreignRoot){
      assertSealedOracleRun(launcher);resolutionOwner=prior!.resolutionOwner!;
    }else{
      const path=join(temporary.path,'oracle-resolution');mkdirSync(path,{recursive:true,mode:0o700});
      const info=lstatSync(path);
      resolutionOwner={pid:process.pid,birth:nodeProcessBirth(process.pid),root:{path,dev:info.dev,ino:info.ino,uid:info.uid}};
    }
    nodeResolutionDirectory(resolutionOwner);
  }
  env[ENVIRONMENT_CONTEXT] = JSON.stringify({ report, owned, temporary,...(resolutionOwner?{resolutionOwner}:{}) } satisfies Context);
  return { env, report, temporary, observations };
}

/** Validate once in the run parent, then forward its exact pinned seal. */
export async function sealOracleRun(planned:GateEnvironment,signal?:AbortSignal,onSession?:(session:NodeResolutionSession,closed:Promise<void>)=>void):Promise<GateEnvironment>{
  const raw=planned.env.NTS_ORACLE_DEPENDENCIES;if(!raw)return planned;
  const context:Context=JSON.parse(planned.env[ENVIRONMENT_CONTEXT]??'null');
  if(context?.report?.version!==1||context.owned?.NTS_ORACLE_DEPENDENCIES!==raw||context.report.host.NTS_ORACLE_DEPENDENCIES!==raw)throw new Error('invalid owned oracle dependency run');
  let cap;try{
    cap=await sealDependencyCapability(JSON.parse(raw),planned.env,signal);
    signal?.throwIfAborted();
    if(process.platform==='linux'){
      const owner=context.resolutionOwner;
      if(!owner)throw Error('oracle resolution run owner is missing or changed');
      const sessionDirectory=nodeResolutionDirectory(owner);
      const execution=JSON.parse(readFileSync(new URL('../differential/oracle-toolchain.json',import.meta.url),'utf8')).execution.args as string[];
      const bootstrap=execution.find((_argument,index)=>index>0&&execution[index-1]==='--import');
      await startNodeResolutionSession(sessionDirectory,nodeResolutionOptions(execution,planned.env,bootstrap),planned.env,owner.pid,onSession);
    }
  }catch(error){if(isCommandExit(error))throw error;if(error instanceof CaseBudgetError)throw error;throw new ToolingInstrumentError('tooling-setup',String(error));}
  const next=JSON.stringify(cap);
  const report={...planned.report,host:{...planned.report.host,NTS_ORACLE_DEPENDENCIES:next}};
  const owned={...context.owned,NTS_ORACLE_DEPENDENCIES:next};
  return {...planned,report,env:{...planned.env,NTS_ORACLE_DEPENDENCIES:next,[ENVIRONMENT_CONTEXT]:JSON.stringify({...context,report,owned})}};
}

/** Standalone commands acquire the same services as the gate parent. Library
 * consumers never prepare. Ambient entries re-enter once so every import and
 * descendant sees the exact sealed environment, without rewriting process.env.
 * A no-op callback at the start of a legacy entry admits the remainder only in
 * that sealed child; the preparing parent transfers its child's exit status. */
export async function withPreparedOracle(
  main:(env:NodeJS.ProcessEnv)=>void|number|Promise<void|number>,
  options:{entry:string;ambient?:boolean;admission?:JobRequest;owned?:NodeJS.ProcessEnv},
):Promise<void|number>{
  const entry=process.argv[1];
  if(!entry||pathToFileURL(resolve(entry)).href!==options.entry)throw new ToolingInstrumentError('tooling-setup','oracle preparation must run at its command entry: '+options.entry);
  const source=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
  const launcher=process.env,values=strings(options.owned??{});
  const context:Context|undefined=launcher[ENVIRONMENT_CONTEXT]?JSON.parse(launcher[ENVIRONMENT_CONTEXT]):undefined;
  if(context){
    if(context.report?.version!==1||!context.owned)throw new ToolingInstrumentError('tooling-setup','invalid oracle entry environment handoff');
    const uncarried=launcherPolicyNames(launcher).filter(name=>name!==ENVIRONMENT_CONTEXT&&name!==ENVIRONMENT_EXPERIMENT&&
      !(CONSUMED as readonly string[]).includes(name)&&!(name in values)&&launcher[name]!==context.owned[name]);
    if(uncarried.length)throw new ToolingInstrumentError('tooling-setup','oracle entry command options were not carried by their owner: '+uncarried.join(', '));
  }
  const base={...launcher};assignOwnedValues(base,values);
  const raw=base.NTS_ORACLE_DEPENDENCIES;
  let inherited:{source?:string;seal?:unknown}|undefined;
  if(raw)try{inherited=JSON.parse(raw);}catch(error){if(isCommandExit(error))throw error;throw new ToolingInstrumentError('tooling-setup','invalid oracle dependency command handoff');}
  if(inherited?.seal){
    assertSealedOracleRun(base);
    if(inherited.source===source)return main(base);
    // A foreign handoff is only an image candidate. Preparation validates
    // this source independently before issuing its own canonical seal.
  }
  const abort=new AbortController();
  let finishSetup!:()=>void;
  const setupClosed=new Promise<void>(done=>{finishSetup=done;});
  // Waiting is cancellable before reserveJob can register an acquired handle.
  // Replace this waiter only after the complete owner is registered, so a
  // shutdown cannot finish while acquisition is still adding resources.
  const unbindWaiting=registerCommandCloser('oracle entry admission '+options.entry,{cancel:()=>abort.abort(),close:()=>setupClosed});
  try{
    const {reserveJob}=await import('./memory-ledger.ts');
    const key='oracle-entry-'+relative(source,fileURLToPath(options.entry)).replace(/\.[^.]+$/,'').replace(/[^a-z0-9]+/g,'-');
    const admission=await reserveJob(options.admission??{key,what:'standalone oracle entry '+options.entry},{signal:abort.signal});
    let planned:GateEnvironment|undefined,session:NodeResolutionSession|undefined,sessionClosed:Promise<void>|undefined,childClosed:Promise<void>|undefined;
    let run:{path:string;dev:number;ino:number;uid:number}|undefined;
    registerCommandCloser('standalone oracle entry '+options.entry,{cancel:()=>abort.abort(),close:async()=>{
      await setupClosed;
      try{
        try{await childClosed;}
        finally{if(session){await closeNodeResolutionSession(session);await sessionClosed;}}
      }finally{
        try{admission.release();await admission.closed;}
        finally{
          if(run){
            const same=()=>{const actual=lstatSync(run!.path);if(!actual.isDirectory()||actual.isSymbolicLink()||actual.dev!==run!.dev||actual.ino!==run!.ino||actual.uid!==run!.uid)throw new ToolingInstrumentError('tooling-cleanup','oracle entry run directory changed: '+run!.path);};
            same();if(planned)discardRunTemporary(planned.temporary,planned.env.HOME!,planned.observations);same();
            removable(run.path);rmSync(run.path,{recursive:true});
          }
        }
      }
    }});
    unbindWaiting();
    const home=base.HOME||userInfo().homedir;
    const capability=raw?JSON.parse(raw):undefined;
    const enclosing=capability?.admission?.kind==='gate'?capability.admission.temporary:undefined;
    if(enclosing)assertRunTemporary(enclosing,home);
    const parent=enclosing?join(enclosing.path,'oracle-entries'):join(home,'.cache/nts/oracle-entries');
    mkdirSync(parent,{recursive:true});
    const path=mkdtempSync(join(parent,'entry-')),identity=lstatSync(path);
    run={path,dev:identity.dev,ino:identity.ino,uid:identity.uid};
    planned=gateEnvironment(base,{run:path,standalone:!base[ENVIRONMENT_CONTEXT],oracleRoot:source,owned:values});
    planned=await sealOracleRun(planned,abort.signal,(acquired,closed)=>{session=acquired;sessionClosed=closed;});
    abort.signal.throwIfAborted();assertSealedOracleRun(planned.env);
    if(!options.ambient){finishSetup();return main(planned.env);}
    const child=spawn(process.execPath,[...process.execArgv,...process.argv.slice(1)],{cwd:process.cwd(),env:planned.env,stdio:'inherit',signal:abort.signal});
    const completed=new Promise<{status:number|null;signal:NodeJS.Signals|null;error?:Error}>(done=>{
      let error:Error|undefined;
      child.once('error',value=>{error=value;});
      child.once('close',(status,signal)=>done({status,signal,...(error?{error}:{})}));
    });
    childClosed=completed.then(()=>{});finishSetup();
    const result=await completed;
    if(result.error||result.signal||result.status===null)throw new ToolingInstrumentError('tooling-setup','standalone oracle child did not finish: '+(result.error??result.signal??'missing status'));
    exitCommand(result.status);
  }finally{finishSetup();}
}

export function reportEnvironment(report: EnvironmentReport, write: (text: string) => void = text => process.stderr.write(text)): void {
  if (report.dropped.length) write(`gate: discarded launcher variable names: ${report.dropped.join(", ")}\n`);
  if (report.jdk) write(report.jdk.declared
    ? `gate: JDK ${report.jdk.home} (${report.jdk.identity}, runtime/jvm/jdk.txt)\n`
    : `gate: no installed JDK is ${report.jdk.identity} (runtime/jvm/jdk.txt); JAVA_HOME stays ${report.jdk.home ?? "unset"}, and the runtime jar will not build\n`);
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
    const lifetime=ownRunTemporary(planned.temporary,planned.env,planned.observations);
    let green=false;
    try{
    const result = spawnSync("sh", [script, "--environment-ready", ...args], {
      env: planned.env,
      // Preserve only the documented gate-tree lock handoff, not arbitrary
      // inherited descriptors. Its inode/ownership is checked by pinned.sh.
      stdio: base.NTS_GATE_LOCK_FD === "8" ? ["inherit", "inherit", "inherit", "ignore", "ignore", "ignore", "ignore", "ignore", 8] : "inherit",
    });
    green=result.status===0&&!result.signal&&!result.error;
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    }finally{lifetime.close(green);}
  } catch (error) { if(isCommandExit(error))throw error;console.error(`gate environment: ${(error as Error).message}`); process.exitCode = 2; }
}
