// On-demand contention diagnosis, never a gate step. One invocation is one
// round; inspect its failures before requesting another stability round.
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync,closeSync,createWriteStream,existsSync,lstatSync,mkdirSync,openSync,readFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAsCommand,registerCommandCloser} from '../differential/command-entry/main.ts';
import {assertSealedOracleRun} from '../differential/oracle-seal/main.ts';
import {defaultSlots} from './budget.ts';
import {CARGO_OWNER,cargoConfiguration} from './cargo.ts';
import {assertLandingEnvironment,gateEnvironment,sealOracleRun} from './canonical-environment.ts';
import {DiskCapacity} from './disk-capacity.ts';
import {durableRecord} from './durable-record.ts';
import {gateCommand,gateCpus,inheritedCpus} from './affinity.ts';
import {gitArguments} from './git-arguments/main.ts';
import {hostObservations} from './host-observations.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {reserveJob} from './memory-ledger.ts';
import {finishRunTemporary} from './run-temporary.ts';
import {requireOwnUnit,startBoundSlice} from './scopes/bound-slice.ts';
import {cpuControls} from './scopes/cpu-limits.ts';
import {memoryEvents} from './scopes/step-scope.ts';
import {ToolingInstrumentError,publishToolingFailure,readStepInstrument} from './step-result.ts';
import {runTestProfile} from './test-profile.ts';
import {discoverToolingTests} from './tooling-discovery.ts';
import {newToolingSlice,stopToolingSlice} from './tooling-slice.ts';
import {runScopedTooling,type ToolingResult} from './tooling-runner.ts';
import {startCpuLoad} from './cpu-load.ts';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const SELF=fileURLToPath(import.meta.url),RUST_RUNNER=fileURLToPath(new URL('./rust-test-runner.ts',import.meta.url));
const QUOTA=800;
const fail=(why:string):never=>{throw new ToolingInstrumentError('tooling-setup','tooling load experiment: '+why);};
const instrument=(error:unknown)=>error instanceof ToolingInstrumentError?error:new ToolingInstrumentError('tooling-setup',String(error),{cause:error});
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('../');};
const probe=(purpose:string,command:string,args:readonly string[],env:NodeJS.ProcessEnv)=>infrastructureProbe({purpose,command,args,cwd:ROOT,env}).stdout.trim();
const git=(args:string[],env:NodeJS.ProcessEnv)=>probe('experiment source identity','git',gitArguments(args),env);
function json<T>(path:string):T{
  const s=lstatSync(path);if(!s.isFile()||s.size>16*1024*1024)fail('expected bounded regular JSON: '+path);
  return JSON.parse(readFileSync(path,'utf8')) as T;
}
type Request={version:1;pin:string;directory:string;group:string;slice:string;workers:number;files:string[];binary:{path:string;sha256:string}};
type RustResult={status:number|null;signal:NodeJS.Signals|null;log:string;summary:string;completedFailures:number};
type WorkerReport={version:1;pin:string;status:number;complete:boolean;node?:ToolingResult&{slice:string};rust?:RustResult;collectorGroup?:string;progress?:number[];error?:string};

async function worker(requestPath:string,env:NodeJS.ProcessEnv):Promise<number>{
  const request=json<Request>(requestPath),host=hostObservations(env);
  assertSealedOracleRun(env);
  if(request.version!==1||!isAbsolute(request.directory)||!request.group.startsWith('/')
    ||!host.ownCgroup().startsWith(request.group+'/')||!inside(join(ROOT,'target/nts-dev'),request.binary.path))fail('worker is outside its prepared experiment');
  if(git(['rev-parse','--verify','HEAD^{commit}'],env)!==request.pin||hash(request.binary.path)!==request.binary.sha256)fail('prepared worker source or artifact changed');
  const report:WorkerReport={version:1,pin:request.pin,status:2,complete:false},publish=()=>durableRecord(join(request.directory,'worker-result.json'),report);
  const load=await startCpuLoad(request.workers);
  void load.failed.catch(error=>durableRecord(join(request.directory,'load-failure.json'),{error:String(error)}));
  try{
    durableRecord(join(request.directory,'load-ready.json'),{workers:request.workers,progress:load.progress(),group:host.ownCgroup()});
    const nodeLog=join(request.directory,'tooling.log'),output=openSync(nodeLog,'wx');
    try{
      // The ordinary collector's inventory check remains the source of the
      // complete file set. Explicitly deferred entries also join this on-demand
      // diagnosis, without changing their gate ownership.
      const selection=discoverToolingTests(ROOT),files=[...selection.files,...selection.exclusions.map(row=>row.path)].sort();
      if(JSON.stringify(files)!==JSON.stringify(request.files))fail('tooling inventory changed after preparation');
      const stream=createWriteStream(nodeLog,{fd:output,autoClose:false});
      try{report.node=await runScopedTooling(files.map(path=>resolve(ROOT,path)),{output:stream,onScope:slice=>{
        const group=probe('collector quota ancestry','systemctl',['--user','show',slice,'--property=ControlGroup','--value'],env);
        if(!group.startsWith(request.group+'/'))fail('collector escaped the experiment quota: '+group);
        report.collectorGroup=group;
      }});}finally{const drained=new Promise<void>((done,reject)=>{stream.once('finish',done);stream.once('error',reject);});stream.end();await drained;}
    }finally{closeSync(output);}
    publish();
    const rustLog=join(request.directory,'rust-cli.log'),fd=openSync(rustLog,'wx');
    const rustEnv:NodeJS.ProcessEnv={...env,NTS_CHECKERS:'1'};
    delete rustEnv.NTS_GATE_STEP_RESULT;delete rustEnv.NTS_GATE_STEP_ATTEMPT;
    try{
      const child=spawn(process.execPath,[RUST_RUNNER,request.binary.path,'--nocapture'],{cwd:ROOT,env:rustEnv,stdio:['ignore',fd,fd]});
      const ended=await new Promise<{status:number|null;signal:NodeJS.Signals|null}>((done,reject)=>{child.once('error',reject);child.once('close',(status,signal)=>done({status,signal}));});
      const text=readFileSync(rustLog,'utf8'),summaries=[...text.matchAll(/^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed;.+$/gm)];
      if(!summaries.length)fail('Rust CLI harness returned without a completed test summary');
      const summary=summaries.at(-1)!;
      if(Number(summary[2])+Number(summary[3])===0)fail('Rust CLI harness measured no cases');
      report.rust={...ended,log:rustLog,summary:summary[0],completedFailures:Number(summary[3])};
    }finally{closeSync(fd);}
    if(hash(request.binary.path)!==request.binary.sha256)fail('Rust CLI artifact changed during execution');
    report.status=report.node.completedFailures||report.rust.completedFailures?1:report.node.status===0&&report.rust.status===0&&report.rust.signal===null?0:2;
  }catch(error){report.error=String(error);report.status=report.node?.completedFailures?1:2;publishToolingFailure(instrument(error),env);}
  finally{
    try{await load.close();}catch(error){report.error=[report.error,String(error)].filter(Boolean).join('; ');report.status=report.status===1?1:2;publishToolingFailure(instrument(error),env);}
    report.progress=load.progress();report.complete=true;publish();
  }
  return report.status;
}

async function round(directory:string):Promise<number>{
  assertLandingEnvironment(process.env);const owner=requireOwnUnit();
  if(inside(ROOT,directory)||directory==='/tmp'||directory.startsWith('/tmp/'))fail('output must be outside the source tree and tmpfs');
  mkdirSync(directory);
  const pin=git(['rev-parse','--verify','HEAD^{commit}'],process.env);
  if(git(['status','--porcelain'],process.env))fail('commit source changes before the experiment');
  const planned=gateEnvironment(process.env,{run:join(directory,'environment'),oracleRoot:ROOT,owned:{NTS_MEMORY_PRIORITY:'agent'}});
  const job=await reserveJob({key:'tooling-load',what:'tooling suite under synthetic CPU load'},{env:planned.env});
  let good=false,acquired=false,childClosed:Promise<{status:number|null;signal:NodeJS.Signals|null}>|undefined;
  let status=2,primary:unknown,outcome:Record<string,unknown>|undefined;
  let configuration:ReturnType<typeof cargoConfiguration>|undefined;
  let timer:ReturnType<typeof setInterval>|undefined,observationFailure:unknown,scopeLog:number|undefined;
  const slice=newToolingSlice(false,{}),unit=slice.slice(0,-6)+'-experiment.scope';
  const cancel=()=>{if(acquired)stopToolingSlice(slice);};
  const unregister=registerCommandCloser('tooling load experiment',{cancel,close:async()=>{cancel();if(childClosed)await childClosed;}});
  try{
    const sealed=await sealOracleRun(planned),env:NodeJS.ProcessEnv={...sealed.env,NTS_BIN:join(ROOT,'target/nts-dev/nts')};
    const host=hostObservations(env),selection=discoverToolingTests(ROOT),files=[...selection.files,...selection.exclusions.map(row=>row.path)].sort();
    const workers=defaultSlots(host.machineWidth());
    const release=new DiskCapacity({env}).beginBuild({root:ROOT,target:join(ROOT,'target'),outputs:['nts-dev']});
    try{
      const fd=openSync(join(directory,'build.log'),'wx');
      try{const build=spawnSync(process.execPath,[CARGO_OWNER,'build','--profile','nts-dev','-p','nts-cli'],{cwd:ROOT,env,stdio:['ignore',fd,fd]});if(build.error||build.signal||build.status!==0)fail('fresh compiler build failed; see build.log');}
      finally{closeSync(fd);}
    }finally{release();}
    const artifactsPath=join(directory,'cargo-artifacts.json');
    if(await runTestProfile('inner',['-p','nts-cli','--test','integration','--no-run'],env,ROOT,{artifacts:artifactsPath})!==0)fail('CLI test build failed');
    const artifacts=json<{version:number;status:number;buildFinished:boolean;artifacts:{manifest_path:string;target:{name:string};executable:string|null}[]}>(artifactsPath);
    const tests=artifacts.artifacts.filter(row=>row.manifest_path===join(ROOT,'tooling/cli/Cargo.toml')&&row.target.name==='integration'&&row.executable);
    if(artifacts.version!==1||artifacts.status!==0||!artifacts.buildFinished||tests.length!==1)fail('CLI test profile did not emit exactly one integration harness');
    const binary={path:tests[0]!.executable!,sha256:hash(tests[0]!.executable!)};
    const group=startBoundSlice(slice,owner);acquired=true;
    probe('experiment CPU quota','systemctl',['--user','set-property',slice,'CPUQuota='+QUOTA+'%'],env);
    const cpu=cpuControls(group),initial=cpu.read();
    if(initial.quotaUsec!==initial.periodUsec*QUOTA/100)fail('kernel did not apply experiment CPU quota');
    const affinity=gateCpus(inheritedCpus()),request:Request={version:1,pin,directory,group,slice,workers,files,binary};
    durableRecord(join(directory,'request.json'),request);
    durableRecord(join(directory,'environment.json'),sealed.report);
    const step='tooling-load',attempt=randomUUID(),instrument=join(directory,'instrument.json');
    const childEnv={...env,NTS_TOOLING_SLICE:slice,NTS_GATE_STEP:step,NTS_GATE_STEP_ATTEMPT:attempt,NTS_GATE_STEP_RESULT:instrument};
    // The current parent also guards the complete executable lifetime, not
    // only its Cargo build. The fresh per-binary scratch is below this root.
    configuration=cargoConfiguration([ROOT,env.TMPDIR!],env);
    const command=gateCommand(process.execPath,[SELF,'--worker',join(directory,'request.json')]);
    scopeLog=openSync(join(directory,'worker.log'),'wx');
    const child=spawn('systemd-run',['--user','--scope','--collect','--quiet','--unit='+unit,'--slice='+slice,
      '--property=BindsTo='+owner,'--property=After='+owner,command.command,...command.args],{cwd:ROOT,env:childEnv,stdio:['ignore',scopeLog,scopeLog]});
    childClosed=new Promise((done,reject)=>{child.once('error',reject);child.once('close',(status,signal)=>done({status,signal}));});
    const resources=join(directory,'resources.jsonl');
    const sample=()=>{
      const row={at:host.wallNow(),now:host.now(),load:host.load(),memory:host.memory(),swap:host.swap(),paging:host.paging(),cpu:cpu.read(),
        residentBytes:host.cgroupCharge(group),memoryEvents:memoryEvents(group),machinePressure:host.machinePressure(),pressure:host.cgroupPressure(group)};
      // Private raw stream. Only the final durable terminal claims completion.
      appendFileSync(resources,JSON.stringify(row)+'\n');
      if(existsSync(join(directory,'load-failure.json')))throw Error(json<{error:string}>(join(directory,'load-failure.json')).error);
    };
    sample();timer=setInterval(()=>{try{sample();}catch(error){
      observationFailure??=error;if(timer)clearInterval(timer);timer=undefined;
      try{cancel();}catch(cleanup){observationFailure=new AggregateError([observationFailure,cleanup],'resource observation and experiment cancellation failed');}
    }},1000);
    const ended=await childClosed;clearInterval(timer);timer=undefined;
    try{sample();}catch(error){observationFailure??=error;}
    const reported=existsSync(join(directory,'worker-result.json'))?json<WorkerReport>(join(directory,'worker-result.json')):undefined;
    const packet=existsSync(instrument)?readStepInstrument(instrument,step,attempt):undefined;
    const definiteFailures=(reported?.node?.completedFailures??0)+(reported?.rust?.completedFailures??0);
    status=definiteFailures?1:observationFailure||!reported||!reported.complete||reported.pin!==pin||reported.status!==ended.status||packet&&reported.status===0?2:reported.status;
    if(git(['rev-parse','--verify','HEAD^{commit}'],env)!==pin||git(['status','--porcelain'],env))fail('source changed during experiment');
    outcome={version:1,pin,status,ended,reported,packet:packet??null,observationFailure:observationFailure?String(observationFailure):null,
      experiment:{slice,group,unit,quotaPercent:QUOTA,workers,affinity,inventory:selection,initialCpu:initial},resources:{path:resources,sha256:hash(resources)},
      separatelyCreatedUnits:'Fixture-created independent units are outside this quota; the retained test output names their own units and outcomes.'};
    good=status===0;
  }catch(error){primary=error;
  }finally{
    if(timer)clearInterval(timer);
    const errors:unknown[]=[];
    try{cancel();}catch(error){errors.push(error);}
    try{if(childClosed)await childClosed;}catch(error){errors.push(error);}
    try{configuration?.verify();}catch(error){
      primary=primary===undefined?error:new ToolingInstrumentError('tooling-setup',String(primary)+'; '+String(error),{cause:new AggregateError([primary,error])});
    }
    try{if(scopeLog!==undefined)closeSync(scopeLog);}catch(error){errors.push(error);}
    try{unregister();}catch(error){errors.push(error);}
    try{job.release();}catch(error){errors.push(error);}
    try{await job.closed;}catch(error){errors.push(error);}
    try{await finishRunTemporary(planned.temporary,planned.env.HOME!,good&&primary===undefined&&errors.length===0,{host:hostObservations(planned.env)});}catch(error){errors.push(error);}
    if(errors.length)primary=new ToolingInstrumentError('tooling-cleanup','tooling load experiment drain failed: '+[...(primary===undefined?[]:[primary]),...errors].map(String).join('; '),{cause:new AggregateError([...(primary===undefined?[]:[primary]),...errors])});
  }
  durableRecord(join(directory,'terminal.json'),{...outcome,version:1,pin,status:primary===undefined?status:2,cleanupComplete:primary===undefined,error:primary===undefined?null:String(primary)});
  if(primary!==undefined)throw primary;
  return status;
}

runAsCommand(import.meta.url,async()=>{
  const args=process.argv.slice(2);
  if(args.length===2&&args[0]==='--worker')return worker(args[1]!,process.env);
  if(args.length!==2||args[0]!=='--out')fail('usage: node tooling/gate/tooling-load.ts --out <fresh kept-scratch directory>');
  return round(resolve(args[1]!));
});
