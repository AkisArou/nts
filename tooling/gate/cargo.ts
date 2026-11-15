// Cargo owns its complete shared cache, including its locks and GC state.
// Configuration is deliberately empty: both spellings in every discovery
// directory must remain absent for the whole invocation.
import {execFileSync,spawnSync,type ExecFileSyncOptions,type ExecFileSyncOptionsWithStringEncoding,type SpawnSyncOptions,type SpawnSyncOptionsWithStringEncoding,type SpawnSyncReturns} from 'node:child_process';
import {lstatSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {cacheLocation} from './cache-capabilities.ts';
import {userInfo} from 'node:os';
import {ToolingInstrumentError} from './step-result.ts';

export const CARGO_OWNER=fileURLToPath(new URL('./cargo.ts',import.meta.url));
export function cargoHome(env:NodeJS.ProcessEnv=process.env):string{
  try{return cacheLocation('CARGO_HOME',env,()=>join(userInfo().homedir,'.cargo'));}
  catch(error){fail('CARGO_HOME','shared cache capability is unavailable',error);}
}
function rustupHome(env:NodeJS.ProcessEnv):string{
  try{return cacheLocation('RUSTUP_HOME',env,()=>join(userInfo().homedir,'.rustup'));}
  catch(error){fail('RUSTUP_HOME','shared toolchain cache capability is unavailable',error);}
}
function fail(path:string,reason:string,cause?:unknown):never{
  throw new ToolingInstrumentError('tooling-setup',`Cargo configuration: ${path}: ${reason}`,{cause});
}
function missing(error:unknown):boolean{return ['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??'');}
function physical(path:string):string{
  try{return realpathSync(path);}catch(error){
    if(!missing(error))fail(path,'cannot observe discovery directory',error);
    const parent=dirname(path);if(parent===path)fail(path,'has no existing discovery ancestor',error);
    return join(physical(parent),path.slice(parent.length));
  }
}
function discoveryDirectories(cwds:readonly string[]):string[]{
  const result=new Set<string>();
  for(const cwd of cwds)for(const root of new Set([resolve(cwd),physical(resolve(cwd))])){
    for(let at=root;;at=dirname(at)){
      result.add(at);
      if(dirname(at)===at)break;
    }
  }
  return [...result];
}
function rustupOverrides(directories:ReadonlySet<string>,env:NodeJS.ProcessEnv):void{
  if(env.RUSTUP_TOOLCHAIN!==undefined)fail('RUSTUP_TOOLCHAIN','an incoming toolchain override is not allowed');
  const home=rustupHome(env);if(!isAbsolute(home))fail(home,'the shared rustup cache must be absolute');
  const settings=join(home,'settings.toml');
  const ran=spawnSync('rustup',['override','list'],{env:{...env,RUSTUP_HOME:home},encoding:'utf8'});
  if(ran.error||ran.signal||ran.status!==0)fail(settings,'cannot read rustup directory overrides: '+(ran.error?.message??ran.stderr??ran.signal??ran.status),ran.error);
  const output=ran.stdout.trim();if(output==='no overrides')return;
  for(const row of output.split('\n')){
    const parts=row.split('\t');
    if(parts.length!==2||!parts[0]||!isAbsolute(parts[0])||!parts[1])fail(settings,'unrecognized rustup override list row: '+JSON.stringify(row));
    const path=parts[0];
    if(directories.has(resolve(path))||directories.has(physical(resolve(path))))fail(settings,'rustup directory override applies at '+path);
  }
}
/** Additional roots are concrete Cargo working directories owned by the caller,
 * such as a Rust test's supplied scratch root, never a recursive path grant. */
export function cargoConfiguration(cwds:readonly string[],env:NodeJS.ProcessEnv=process.env):{verify():void}{
  if(!cwds.length||cwds.some(cwd=>!isAbsolute(cwd)))fail(String(cwds),'working directories must be absolute');
  const home=cargoHome(env);if(!isAbsolute(home))fail(home,'the shared Cargo cache must be absolute');
  const before=discoveryDirectories(cwds);
  const verify=()=>{
    const directories=new Set([...before,...discoveryDirectories(cwds)]);
    const paths=new Set([join(home,'config'),join(home,'config.toml'),... [...directories].flatMap(at=>[join(at,'.cargo/config'),join(at,'.cargo/config.toml')])]);
    for(const path of [...paths].sort()){
      try{lstatSync(path);}catch(error){if(missing(error))continue;fail(path,'cannot establish absence',error);}
      fail(path,'outside configuration is not allowed; remove it from the Cargo discovery chain');
    }
    rustupOverrides(directories,env);
  };
  verify();return {verify};
}
type CargoConfiguration=ReturnType<typeof cargoConfiguration>;
function finishConfiguration(guard:CargoConfiguration,primary:{error:unknown}|undefined):void{
  try{guard.verify();}catch(error){
    if(primary)throw new ToolingInstrumentError('tooling-setup',String(error)+'; guarded operation also failed: '+String(primary.error),{cause:new AggregateError([primary.error,error])});
    throw error;
  }
  if(primary)throw primary.error;
}
export function withCargoConfigurationSync<T>(cwds:readonly string[],env:NodeJS.ProcessEnv,body:(guard:CargoConfiguration)=>T):T{
  const guard=cargoConfiguration(cwds,env);
  let value:T|undefined,primary:{error:unknown}|undefined;
  try{value=body(guard);}catch(error){primary={error};}
  finishConfiguration(guard,primary);
  return value as T;
}
/** The current parent also guards historical code through its complete drain. */
export async function withCargoConfiguration<T>(cwds:readonly string[],env:NodeJS.ProcessEnv,body:(guard:CargoConfiguration)=>Promise<T>):Promise<T>{
  const guard=cargoConfiguration(cwds,env);
  let value:T|undefined,primary:{error:unknown}|undefined;
  try{value=await body(guard);}catch(error){primary={error};}
  finishConfiguration(guard,primary);
  return value as T;
}
function assertArguments(args:readonly string[]):void{
  const end=args.indexOf('--'),cargo=end<0?args:args.slice(0,end);
  if(cargo.some(argument=>argument==='--config'||argument.startsWith('--config=')))fail('--config','callers cannot replace the gate-owned empty configuration');
  if(cargo.some(argument=>argument.startsWith('-C')))fail('-C','callers cannot change the guarded working directory');
  if(args[0]?.startsWith('+'))fail(args[0],'callers cannot replace the source-owned Rust toolchain');
}
function roots(cwd:string,env:NodeJS.ProcessEnv):string[]{return [resolve(cwd),...(env.NTS_TEST_SCRATCH_ROOT?[resolve(cwd,env.NTS_TEST_SCRATCH_ROOT)]:[])];}
function directory(cwd:string|URL|undefined):string{return cwd instanceof URL?fileURLToPath(cwd):resolve(cwd??process.cwd());}
export function cargoSync(args:readonly string[],options:SpawnSyncOptionsWithStringEncoding):SpawnSyncReturns<string>;
export function cargoSync(args:readonly string[],options?:SpawnSyncOptions):SpawnSyncReturns<string|Buffer>;
export function cargoSync(args:readonly string[],options:SpawnSyncOptions={}):SpawnSyncReturns<string|Buffer>{
  assertArguments(args);const env=options.env??process.env,cwd=directory(options.cwd);
  return withCargoConfigurationSync(roots(cwd,env),env,()=>spawnSync('cargo',args,{...options,env:{...env,CARGO_HOME:cargoHome(env),RUSTUP_HOME:rustupHome(env)}}));
}
export function cargoOutput(args:readonly string[],options:ExecFileSyncOptionsWithStringEncoding,execute?:typeof execFileSync):string;
export function cargoOutput(args:readonly string[],options?:ExecFileSyncOptions,execute?:typeof execFileSync):string|Buffer;
export function cargoOutput(args:readonly string[],options:ExecFileSyncOptions={},execute:typeof execFileSync=execFileSync):string|Buffer{
  assertArguments(args);const env=options.env??process.env,cwd=directory(options.cwd);
  return withCargoConfigurationSync(roots(cwd,env),env,()=>execute('cargo',args,{...options,env:{...env,CARGO_HOME:cargoHome(env),RUSTUP_HOME:rustupHome(env)}}));
}
runAsCommand(import.meta.url,()=>{
  const ran=cargoSync(process.argv.slice(2),{stdio:'inherit'});
  if(ran.error||ran.signal)throw new ToolingInstrumentError('tooling-setup','Cargo command: '+(ran.error?.message??'killed by '+ran.signal));
  return ran.status??2;
});
