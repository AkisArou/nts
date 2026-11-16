// Host capabilities and owned child temporaries, independent of preparation.
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync} from 'node:fs';
import {userInfo} from 'node:os';
import {dirname,join,relative,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertRunTemporary,captureRunTemporary} from './run-temporary.ts';
import {FIXTURE_ENVIRONMENT,cacheLocation} from './cache-environment.ts';
import {ENVIRONMENT_CONTEXT,assertSealedOracleRun} from '../differential/oracle-seal/main.ts';
import {ToolingInstrumentError} from './step-result.ts';
import type {Context} from './environment-types.ts';
import {HOST_INFRASTRUCTURE} from "./host-infrastructure.ts";
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
  const temporary=captureRunTemporary(run,context.temporary,env.HOME!);
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

export function hostEnvironment(launcher: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const host: NodeJS.ProcessEnv = {};
  for (const name of HOST_CAPABILITIES) if (launcher[name] !== undefined) host[name] = launcher[name];
  host.HOME ||= userInfo().homedir;
  // This is the complete content cache, not configuration authority. cargo.ts
  // refuses both configuration spellings before and after every invocation.
  if(launcher[FIXTURE_ENVIRONMENT]===undefined)host.CARGO_HOME ||= join(host.HOME, ".cargo");
  if(launcher[FIXTURE_ENVIRONMENT]===undefined)host.RUSTUP_HOME ||= join(host.HOME, ".rustup");
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

/** Keep classification at the launcher boundary, not in the node-only leaf. */
export function requireSealedOracleRun(env:NodeJS.ProcessEnv):void{
  try{assertSealedOracleRun(env);}
  catch(error){throw new ToolingInstrumentError('tooling-setup',error instanceof Error?error.message:String(error),{cause:error});}
}

