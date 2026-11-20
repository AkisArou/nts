import {CARGO_OWNER} from './cargo.ts';
// Every Rust test build uses this owner, including rustdoc and shell callers.
// Cargo's JSON reports prove the files came from the selected profile; the
// manifest and environment checks also cover settings absent from that report.
import {spawn} from 'node:child_process';
import {accessSync,constants,readFileSync,realpathSync,statSync} from 'node:fs';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ToolingInstrumentError,publishToolingFailure} from './step-result.ts';
import {completeBuild} from './build-completion.ts';
import {DiskCapacity} from './disk-capacity.ts';
import {ENVIRONMENT_CONTEXT,assertSealedOracleRun} from '../differential/oracle-seal/main.ts';
import {durableRecord} from './durable-record.ts';
import {ownedProcessGroup} from './process-group.ts';
import {registerCommandCloser} from '../differential/command-entry/main.ts';

export const TEST_PROFILE='nts-dev';
export const TEST_INCREMENTAL='1';
export const TEST_PROFILE_MANIFEST=fileURLToPath(new URL('../../Cargo.toml',import.meta.url));
export const TEST_ROUTES=['workspace','inner','frontend','doctests','doctests-build'] as const;
export type TestRoute=typeof TEST_ROUTES[number];
export type TestInvocation={route:TestRoute;args:string[];env:NodeJS.ProcessEnv;cwd:string;profileDirectory:string;targetDirectory:string};
function fail(why:string):never {throw new ToolingInstrumentError('tooling-setup','Rust test profile: '+why);}
const fields={inherits:'"release"',debug:'0',incremental:'true',lto:'false','codegen-units':'16','overflow-checks':'true','debug-assertions':'true'} as const;

export function assertTestProfileManifest(source:string):void {
  const section=source.split(/(?=^\[)/m).find(part=>part.startsWith('[profile.'+TEST_PROFILE+']\n'));
  if(!section)fail('manifest has no '+TEST_PROFILE+' profile');
  for(const [name,value] of Object.entries(fields)){
    const matches=[...section.matchAll(new RegExp('^'+name+'\\s*=\\s*([^#\\n]+)','gm'))];
    if(matches.length!==1||matches[0]?.[1]?.trim()!==value)fail('manifest '+TEST_PROFILE+'.'+name+' must be '+value);
  }
}

/** Refuse caller policy before constructing a command, rather than silently
 * replacing it and letting an experiment masquerade as the shared route. */
export function assertTestInvocation(invocation:TestInvocation):void {
  const {args,env}=invocation,stop=args.indexOf('--'),cargo=stop<0?args:args.slice(0,stop);
  if(cargo[0]!=='test'||cargo.filter(arg=>arg==='--profile').length!==1||cargo[cargo.indexOf('--profile')+1]!==TEST_PROFILE
      ||cargo.some(arg=>arg==='--release'||arg==='-r'||arg.startsWith('--profile=')))fail(invocation.route+' must build with --profile '+TEST_PROFILE);
  if(cargo.some(arg=>/^--(?:config|manifest-path|target-dir)(?:=|$)/.test(arg)))fail(invocation.route+' cannot replace the owned manifest, target or profile configuration');
  if(!cargo.includes('--no-fail-fast')||!cargo.includes('--message-format=json'))fail(invocation.route+' lost failure or artifact evidence');
  if(env.CARGO_INCREMENTAL!==TEST_INCREMENTAL)fail(invocation.route+' requires CARGO_INCREMENTAL='+TEST_INCREMENTAL);
  if(env.NTS_TEST_PROFILE!==undefined&&env.NTS_TEST_PROFILE!==TEST_PROFILE)fail('NTS_TEST_PROFILE must be '+TEST_PROFILE);
  for(const name of ['RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS'])if(env[name])fail('conflicting '+name+' overrides the test build');
  for(const [name,value] of Object.entries(env))if(name.startsWith('CARGO_PROFILE_NTS_DEV_')&&value!==undefined){
    const field=name.slice('CARGO_PROFILE_NTS_DEV_'.length).toLowerCase().replaceAll('_','-');
    if(!(field in fields)||value!==fields[field as keyof typeof fields].replaceAll('"',''))fail('conflicting '+name+'='+value);
  }
}

export function testInvocation(route:TestRoute,selection:readonly string[]=[],environment:NodeJS.ProcessEnv=process.env,cwd=process.cwd()):TestInvocation {
  if(!TEST_ROUTES.includes(route))fail('unknown route '+String(route));
  if(environment.CARGO_INCREMENTAL!==undefined&&environment.CARGO_INCREMENTAL!==TEST_INCREMENTAL)fail(route+' requires CARGO_INCREMENTAL='+TEST_INCREMENTAL);
  const env:NodeJS.ProcessEnv={...environment,CARGO_INCREMENTAL:TEST_INCREMENTAL,NTS_CHECKERS:'1'};
  let chosen:string[];
  if(route==='workspace')chosen=['--workspace',...selection];
  else if(route==='frontend'){
    if(selection.length)fail('frontend route takes no arguments');
    chosen=['-p','nts-frontend-ts','--test','integration','--jobs','4','--','native_invariants::','--ignored','--test-threads=1'];
  }else if(route==='doctests'||route==='doctests-build'){
    if(selection.length)fail('doctests selects crates through NTS_DOCTEST_CRATES');
    const crates=(env.NTS_DOCTEST_CRATES??'').trim().split(/\s+/).filter(Boolean);
    if(crates.some(name=>!/^[A-Za-z0-9_-]+$/.test(name)))fail('invalid NTS_DOCTEST_CRATES');
    chosen=['--doc',...(crates.length?[...new Set(crates)].flatMap(name=>['-p',name]):['--workspace'])];
    if(route==='doctests-build')chosen.push('--','--list');
  }else chosen=[...selection];
  const args=['test','--profile',TEST_PROFILE,'--no-fail-fast','--message-format=json',...chosen];
  const targetAt=args.indexOf('--target'),target=targetAt<0?env.CARGO_BUILD_TARGET:args[targetAt+1];
  const targetDirectory=resolve(cwd,env.CARGO_TARGET_DIR??'target');
  const invocation={route,args,env,cwd,targetDirectory,profileDirectory:resolve(targetDirectory,target??'',TEST_PROFILE)};
  assertTestInvocation(invocation);
  return invocation;
}

/** Every compiler artifact, including a doctest's input library, belongs below
 * the selected profile. A false test flag cannot hide a wrong-profile file. */
export function assertTestArtifact(invocation:TestInvocation,value:unknown):boolean {
  if(!value||typeof value!=='object')return false;
  const row=value as {reason?:unknown;filenames?:unknown;executable?:unknown;profile?:{debuginfo?:unknown;test?:unknown}};
  if(row.reason!=='compiler-artifact')return false;
  if(!Array.isArray(row.filenames)||!row.filenames.length||row.filenames.some(file=>typeof file!=='string'))fail('invalid compiler-artifact filenames');
  for(const file of [...row.filenames,...(typeof row.executable==='string'?[row.executable]:[])]){
    const part=relative(invocation.profileDirectory,resolve(invocation.cwd,file as string));
    if(isAbsolute(part)||part==='..'||part.startsWith('..'+sep))fail(invocation.route+' artifact outside '+invocation.profileDirectory+': '+String(file));
  }
  if(row.profile?.debuginfo!==0)fail(invocation.route+' artifact has debug info: '+String(row.profile?.debuginfo));
  return true;
}

export async function runTestProfile(route:TestRoute,selection:readonly string[]=[],env:NodeJS.ProcessEnv=process.env,cwd=process.cwd(),evidence?:{artifacts?:string;requireFresh?:boolean}):Promise<number> {
  if(evidence?.artifacts&&!isAbsolute(evidence.artifacts))fail('artifact evidence needs an absolute path');
  const invocation=testInvocation(route,selection,env,cwd);
  assertPreparedInnerTests(invocation);
  assertTestProfileManifest(readFileSync(resolve(cwd,'Cargo.toml'),'utf8'));
  // Validate the exact values handed to spawn, not a separate policy projection.
  assertTestInvocation(invocation);
  const release=new DiskCapacity({env:invocation.env}).beginBuild({root:cwd,target:resolve(invocation.profileDirectory,'..'),outputs:['nts-dev']});
  try{
  const child=spawn(process.execPath,[CARGO_OWNER,...invocation.args],{cwd,env:invocation.env,detached:true,stdio:['inherit','pipe','inherit']});
  let group:ReturnType<typeof ownedProcessGroup>;
  let pending='',artifacts=0,buildFinished=false,problem:unknown;
  const stop=()=>group?.signal('SIGKILL');
  const statusPromise=new Promise<number>((done,reject)=>{
    child.once('error',error=>reject(new ToolingInstrumentError('tooling-setup','Rust test profile: cannot start cargo',{cause:error})));
    child.once('exit',()=>{try{stop();}catch(error){problem??=error;}});
    child.once('close',(code,signal)=>{if(signal&&!problem)reject(new ToolingInstrumentError('tooling-setup','Rust test profile: cargo killed by '+signal));else done(code??2);});
  });
  const unregister=registerCommandCloser('Cargo test command',{cancel:stop,close:async()=>{await statusPromise;group?.assertEmpty();}});
  try{
  try{group=ownedProcessGroup(child);}catch(error){problem=error;}
  const artifactRows:unknown[]=[],buildScripts:unknown[]=[];
  const line=(text:string)=>{
    let value:unknown;
    try{value=JSON.parse(text);}catch{process.stdout.write(text+'\n');return;}
    const event=value as {reason?:unknown;message?:{rendered?:unknown}};
    if(!buildFinished&&event&&typeof event==='object'&&['compiler-artifact','compiler-message','build-script-executed','build-finished'].includes(String(event.reason))){
      try{if(assertTestArtifact(invocation,event)){
        artifacts++;if(evidence?.requireFresh&&(event as {fresh?:unknown}).fresh!==true)fail('doctests compiled an artifact instead of reusing its build preparation');
        if(evidence?.artifacts)artifactRows.push(event);
      }}catch(error){if(!problem){problem=error;stop();}}
      if(event.reason==='build-script-executed'){
        const script=event as {package_id?:unknown;out_dir?:unknown};
        if(typeof script.package_id!=='string'||!script.package_id||typeof script.out_dir!=='string'||!isAbsolute(script.out_dir)
          ||relative(invocation.profileDirectory,script.out_dir).split(sep).includes('..'))problem??=new ToolingInstrumentError('tooling-setup','Rust test profile: invalid build-script OUT_DIR');
        else if(evidence?.artifacts)buildScripts.push(event);
      }
      if(event.reason==='compiler-message'&&typeof event.message?.rendered==='string')process.stdout.write(event.message.rendered);
      if(event.reason==='build-finished'){
        buildFinished=true;
        if((event as {success?:unknown}).success===true&&!problem&&artifacts&&route==='workspace'
          &&selection.every(arg=>['--no-run','--locked','--offline','--frozen'].includes(arg)))completeBuild(cwd,TEST_PROFILE,invocation.profileDirectory);
      }
    }else process.stdout.write(text+'\n');
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',(chunk:string)=>{pending+=chunk;let end:number;while((end=pending.indexOf('\n'))>=0){line(pending.slice(0,end));pending=pending.slice(end+1);}});
  const status=await statusPromise;
  group?.assertEmpty();
  if(pending)line(pending);
  if(evidence?.artifacts)durableRecord(evidence.artifacts,{version:2,status,buildFinished,artifacts:artifactRows,buildScripts,
    invocation:{cwd:invocation.cwd,profileDirectory:invocation.profileDirectory,args:invocation.args},
    buildNamespace:status===0&&artifacts&&buildFinished?realpathSync(invocation.targetDirectory):invocation.targetDirectory});
  if(problem)throw problem;
  if(status===0&&!artifacts)fail(route+' produced no compiler-artifact evidence');
  if(status===0&&!buildFinished)fail(route+' produced no build-finished evidence');
  if(evidence?.requireFresh)console.log('doctests: reused '+artifacts+' fresh Cargo artifacts; compiled 0');
  return status;
  }finally{unregister();}
  }finally{release();}
}

/** inner.ts owns preparation; this module owns only the Cargo invocation.
 * Compile-only invocations need neither an oracle nor an executable. */
export function assertPreparedInnerTests(invocation:TestInvocation):void{
  const stop=invocation.args.indexOf('--'),cargo=stop<0?invocation.args:invocation.args.slice(0,stop);
  if(invocation.route!=='inner'||cargo.includes('--no-run'))return;
  const command='node tooling/gate/inner.ts --no-agree';
  const missing=[ENVIRONMENT_CONTEXT,'NTS_ORACLE_DEPENDENCIES','NTS_BIN'].filter(name=>!invocation.env[name]);
  if(missing.length)fail('inner tests need prepared '+missing.join(', ')+'; run '+command);
  try{assertSealedOracleRun(invocation.env);}
  catch(error){fail('inner tests need a sealed oracle capability: '+String(error)+'; run '+command);}
  const compiler=resolve(invocation.profileDirectory,'nts');
  if(!isAbsolute(invocation.env.NTS_BIN!)||resolve(invocation.env.NTS_BIN!)!==compiler)
    fail('inner NTS_BIN must name the compiler built by '+command+' at '+compiler);
  try{if(!statSync(compiler).isFile())throw Error('not a file');accessSync(compiler,constants.X_OK);}
  catch(error){fail('inner NTS_BIN is unavailable at '+compiler+': '+String(error)+'; run '+command);}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),artifacts=args[0]==='--artifacts'?args.splice(0,2)[1]:undefined;
  const [route,...selection]=args;
  runTestProfile(route as TestRoute,selection,process.env,process.cwd(),artifacts?{artifacts}:undefined).then(status=>{process.exitCode=status;},error=>{if(error instanceof ToolingInstrumentError)publishToolingFailure(error);console.error('NOT MEASURED: '+String(error));process.exitCode=2;});
}
