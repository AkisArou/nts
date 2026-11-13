import {registerCommandCloser} from '../differential/command-entry/main.ts';
// Ambient behavior belongs to the gate's environment contract. Only the
// harness's explicit inputs and child protocol cross this boundary as well.
import {hostEnvironment,FIXED_AMBIENT,ENVIRONMENT_CONTEXT,gateEnvironment} from "../gate/canonical-environment.ts";
import {existsSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";

const INPUTS = [
  "NTS_BIN", "NTS_COMPILER", "NTS_ADDON_OUT", "NTS_CONFORMANCE_OUT",
  "NTS_ADDON_EMITTED", "NTS_ADDON_SIBLING_CACHE", "NTS_NATIVE_OBJ_CACHE",
  "NTS_CONFORMANCE_TIMEOUT_MS", "NTS_CONFORMANCE_RC", "NTS_CONFORMANCE_ORACLE", "NTS_KEEP_TEMP",
] as const;
export function nodeInputs(launcher:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
  return Object.fromEntries(INPUTS.filter(name=>launcher[name]!==undefined).map(name=>[name,launcher[name]]));
}

// **The directories made here are this process's.** A runner with no TMPDIR or
// NODE_TEST_DIR above it gets ~/.cache/nts-conformance/<pid> and
// ~/.cache/n<pid in base 36> -- that one short, because a Unix socket name has
// 107 bytes and tests append to `common.PIPE`. Nothing removed either, and by
// 11-06 1,227 NODE_TEST_DIR roots, nearly all empty, sat in ~/.cache. So each
// is marked, removed when its process exits, and, when the process was killed
// first, removed by the next runner that makes its own: a mark naming a dead
// pid is a leftover. Only marked directories are touched, so nothing else named
// n<letters> is; NTS_KEEP_TEMP marks them kept, as it keeps each test's own.
export const OWNER_MARK=".nts-node-environment";
const made=new Set<string>();
const alive=(pid:number)=>{
  try{process.kill(pid,0);return true;}
  catch(error){return (error as NodeJS.ErrnoException).code==="EPERM";}
};

function own(dir:string,keep:boolean):void {
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,OWNER_MARK),`${process.pid}${keep?" kept":""}\n`);
  if(made.has(dir))return;
  made.add(dir);
  if(!keep)registerCommandCloser('scratch conformance/node-environment.ts',{close:()=>rmSync(dir,{recursive:true,force:true})});
}

/** Removes the marked directories whose process is gone and which nobody kept; returns how many. */
export function sweepLeftovers(home:string):number {
  const cache=join(home,".cache"),conformance=join(cache,"nts-conformance");
  const candidates=[
    ...(existsSync(cache)?readdirSync(cache).filter(name=>/^n[0-9a-z]+$/.test(name)).map(name=>join(cache,name)):[]),
    ...(existsSync(conformance)?readdirSync(conformance).map(name=>join(conformance,name)):[]),
  ];
  let removed=0;
  for(const dir of candidates){
    let mark:string;
    try{mark=readFileSync(join(dir,OWNER_MARK),"utf8").trim();}catch{continue;}
    const [pid,kept]=mark.split(" ");
    if(kept!==undefined||!/^\d+$/.test(pid??"")||alive(Number(pid)))continue;
    rmSync(dir,{recursive:true,force:true});
    removed++;
  }
  return removed;
}

/**
 * The environment node's own tests and the harness's children run in: host
 * capabilities, the fixed ambient values, the harness's inputs and `owned`.
 * It carries no canonical context (NTS_GATE_ENV_CONTEXT), so the TMPDIR it
 * gives never meets one. Tooling children use nodeToolingEnvironment instead,
 * after childTemporary has registered their own temporary in the context.
 */
export function nodeEnvironment(launcher:NodeJS.ProcessEnv,owned:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv {
  const host=hostEnvironment(launcher);
  const inputs=nodeInputs(launcher);
  const env:NodeJS.ProcessEnv={...host,...FIXED_AMBIENT,...inputs,NTS_CHECKERS:"1",...owned};
  const given={tmp:owned.TMPDIR??launcher.TMPDIR,test:owned.NODE_TEST_DIR??launcher.NODE_TEST_DIR};
  const keep=env.NTS_KEEP_TEMP!==undefined;
  if(given.tmp===undefined||given.test===undefined)sweepLeftovers(host.HOME!);
  const runner=join(host.HOME!,".cache/nts-conformance",String(process.pid));
  env.TMPDIR=resolve(given.tmp??join(runner,"tmp"));
  // Unix socket names have 107 bytes, including test-specific suffixes.
  env.NODE_TEST_DIR=resolve(given.test??join(host.HOME!,".cache",`n${process.pid.toString(36)}`));
  env.XDG_CACHE_HOME=join(host.HOME!,".cache");
  if(given.tmp===undefined)own(runner,keep);
  if(given.test===undefined)own(env.NODE_TEST_DIR,keep);
  mkdirSync(env.TMPDIR,{recursive:true});
  mkdirSync(env.NODE_TEST_DIR,{recursive:true});
  return env;
}

/** Tooling keeps the canonical handoff; node's actual tests keep the boundary above. */
export function nodeToolingEnvironment(launcher:NodeJS.ProcessEnv,owned:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv {
  const paths=nodeEnvironment(launcher,owned);
  if(!launcher[ENVIRONMENT_CONTEXT])return paths;
  return gateEnvironment(launcher,{run:dirname(launcher.TMPDIR!),owned:{
    ...nodeInputs(launcher),...owned,NODE_TEST_DIR:paths.NODE_TEST_DIR,NTS_CHECKERS:"1",
  }}).env;
}
