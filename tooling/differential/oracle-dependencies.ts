// One run-owned, offline dependency image. The existing pinned pnpm provisioner
// owns registry integrity; an application installation is never a fallback.
import {createHash} from 'node:crypto';
import {dependencySealIdentity,dependencySealReady,ownsDependencyRun,capturedPackageMetadata,type DependencyRunSeal} from './oracle-filesystem.ts';
import {execFileSync} from 'node:child_process';
import {appendFileSync,chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {DEPENDENCY_ROOT_INPUTS,identity,installDependencies,type Identity} from '../inputs/dependency-inputs.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {managerPin,withPackageManager} from '../inputs/package-manager.ts';
import {activeCommand} from '../gate/active-command.ts';
import {TemporaryAdmission,type TemporaryAdmissionContext} from '../gate/admission.ts';
import {hostObservations} from '../gate/host-observations.ts';
import {reserveJob} from '../gate/memory-ledger.ts';
import {MemoryRun} from '../census/worker-memory.ts';
import {CaseBudgetError,ToolingInstrumentError} from '../gate/step-result.ts';
import {moduleClosure} from '../gate/module-closure.ts';
export {CaseBudgetError,ToolingInstrumentError};

const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
export type DependencyCapability={seal?:DependencyRunSeal;version:1;source:string;sourceRevision:string;lockfileSha256:string;helperSha256:string;producerSha256:string;directory:string;admission:TemporaryAdmissionContext;ownerStep:string|null};
type Entry={path:string;kind:'directory';mode:number}|{path:string;kind:'file';mode:number;bytes:number;sha256:string}|{path:string;kind:'link';target:string};
type InstallInputs={version:1;identity:Identity;paths:string[];selectionPaths:string[];treeRows:string[];treeSha256:string};
export type DependencyImage={version:1;source:string;sourceRevision:string;inputSet:InstallInputs;lockfileSha256:string;treeSha256:string;manager:ReturnType<typeof managerPin>;entries:Entry[];ownerStep:string|null;cost:{wallMs:number;selectionWallMs:number;userSeconds:number;systemSeconds:number;bytes:number;allocatedBytes:number;peakBytes:number;residentBudgetBytes:number;cpuBudgetSeconds:number;reservedBytes:number}};
function git(root:string,...args:string[]){return execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:Infinity}).trim();}
const CAPTURE_BYTES=2*2**30,CAPTURE_CPU_SECONDS=300;
// Actual independent-copy capture allocated 518,709,248 bytes. Reserve the
// next GiB before building; a larger image holds instead of publishing.
const CAPTURE_DISK_BYTES=2**30;
// The capability's tree owns its layout, including trees older or newer than
// this launcher. Walk its declarations afresh before authenticating the bytes.
function producerIdentity(source:string){return hash(JSON.stringify(moduleClosure(['tooling/differential/oracle-dependencies.ts'],{sourceRoot:source}).map(file=>[file,hash(readFileSync(join(source,file)))])));}
export function dependencyCapability(source:string,directory:string,admission:TemporaryAdmissionContext={kind:'standalone'},ownerStep:string|null=null,env:NodeJS.ProcessEnv=process.env):DependencyCapability{
  source=realpathSync(source);
  // sourceRevision is the committed revision anchor. Only the async install-input
  // projection below determines the source image, never HEAD's whole tree.
  const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:source,env,encoding:'utf8'}).trim();
  return {version:1,source,sourceRevision,lockfileSha256:hash(readFileSync(join(source,'pnpm-lock.yaml'))),
    helperSha256:hash(readFileSync(fileURLToPath(import.meta.url))),producerSha256:producerIdentity(source),directory:resolve(directory),admission,ownerStep};
}
export function dependencyInventory(root:string):Entry[]{
  const result:Entry[]=[];
  const walk=(directory:string)=>{
    for(const name of readdirSync(directory).sort()){
      const file=join(directory,name),info=lstatSync(file),path=relative(root,file);
      if(info.isSymbolicLink()){
        const target=readlinkSync(file);
        if(isAbsolute(target)||!inside(root,resolve(dirname(file),target)))throw Error('oracle dependency link escapes capture: '+file);
        result.push({path,kind:'link',target});
      }else if(info.isDirectory()){result.push({path,kind:'directory',mode:info.mode&0o777});walk(file);}
      else if(info.isFile()){const bytes=readFileSync(file);result.push({path,kind:'file',mode:info.mode&0o777,bytes:bytes.length,sha256:hash(bytes)});}
      else throw Error('oracle dependency capture contains unsupported file: '+file);
    }
  };
  walk(root);return result;
}
export function protectDependencyImage(root:string):Entry[]{
  const entries=dependencyInventory(root);
  for(const entry of entries)if(entry.kind==='file'&&lstatSync(join(root,entry.path)).nlink!==1)throw Error('oracle dependency image shares a regular-file inode: '+entry.path);
  for(const entry of entries)if(entry.kind!=='link'){
    entry.mode=entry.kind==='directory'||entry.mode&0o111?0o555:0o444;
    chmodSync(join(root,entry.path),entry.mode);
  }
  chmodSync(root,0o555);
  return entries;
}
export function dependencyPackageInventory(entries:Entry[]):Entry[]{
  const bookkeeping=(path:string)=>path.split(sep).some((part,i,parts)=>parts[i-1]==='node_modules'&&part==='.bin')||
    /(?:^|\/)node_modules\/(?:\.modules\.yaml|\.pnpm-workspace-state-v1\.json)$/.test(path)||
    /(?:^|\/)node_modules\/\.pnpm\/lock\.yaml$/.test(path);
  const workspaces=entries.filter(entry=>entry.kind==='link').map(entry=>resolve('/',dirname(entry.path),entry.target).slice(1)).filter(path=>!path.split(sep).includes('node_modules'));
  return entries.filter(entry=>!bookkeeping(entry.path)&&(entry.path.split(sep).includes('node_modules')||workspaces.some(root=>entry.path===root||entry.path.startsWith(root+sep))));
}
function publish(file:string,value:unknown){const pending=file+'.pending';writeFileSync(pending,JSON.stringify(value,null,2)+'\n',{flag:'wx'});renameSync(pending,file);}
function checked(capability:DependencyCapability){
  if(capability?.version!==1||!isAbsolute(capability.source)||!isAbsolute(capability.directory)||!capability.directory.includes(sep+'tmp'+sep))throw Error('invalid oracle dependency capability');
  if(capability.admission?.kind!=='gate'&&capability.admission?.kind!=='standalone')throw Error('invalid oracle dependency admission context');
  if(capability.ownerStep!==null&&(typeof capability.ownerStep!=='string'||!/^[a-z][a-z0-9-]*$/.test(capability.ownerStep)))throw Error('invalid oracle dependency owner step');
  if(hash(readFileSync(fileURLToPath(import.meta.url)))!==capability.helperSha256)throw Error('oracle dependency provisioner source mismatch');
  if(producerIdentity(capability.source)!==capability.producerSha256)throw Error('oracle dependency producer source changed');
  if(hash(readFileSync(join(capability.source,'pnpm-lock.yaml')))!==capability.lockfileSha256)throw Error('oracle dependency lockfile changed: '+capability.source);
}

function cleanInputs(source:string,paths:readonly string[]){
  if(git(source,'status','--porcelain','--untracked-files=all','--',...paths))throw Error('oracle dependency install input is dirty');
}
function selectionRows(capability:DependencyCapability,revision:string):string[]{
  return git(capability.source,'ls-tree','-rz','--full-tree',revision).split('\0').filter(row=>{
    const path=row.slice(row.indexOf('\t')+1);
    return (DEPENDENCY_ROOT_INPUTS as readonly string[]).includes(path)||path.endsWith('/package.json')||path.endsWith('/.npmrc');
  });
}
function inputRows(capability:DependencyCapability,paths:string[],metadata=selectionRows(capability,capability.sourceRevision)){
  if(JSON.stringify(metadata)!==JSON.stringify(selectionRows(capability,'HEAD')))throw Error('oracle dependency committed install inputs changed: package metadata set');
  cleanInputs(capability.source,paths);
  const rows=(revision:string)=>git(capability.source,'ls-tree','-rz','--full-tree',revision,'--',...paths).split('\0').filter(Boolean);
  const treeRows=rows(capability.sourceRevision);
  if(JSON.stringify(treeRows)!==JSON.stringify(rows('HEAD')))throw Error('oracle dependency committed install inputs changed');
  return treeRows;
}
async function installInputs(capability:DependencyCapability,counts:{pnpmSelectionCommands:number}):Promise<InstallInputs>{
  checked(capability);
  // This small tree supplies committed manifests to the same pnpm authority.
  // It never discovers membership from files that have since been removed.
  const metadata=selectionRows(capability,capability.sourceRevision);
  if(metadata.some(row=>!/^100(?:644|755) blob /.test(row)))throw Error('oracle dependency selection input is not a tracked regular file');
  const selectionPaths=metadata.map(row=>row.slice(row.indexOf('\t')+1));
  cleanInputs(capability.source,[...DEPENDENCY_ROOT_INPUTS,...selectionPaths]);
  mkdirSync(capability.directory,{recursive:true});
  const selection=mkdtempSync(join(capability.directory,'selection-')),tree=join(selection,'tree'),archive=join(selection,'source.tar');mkdirSync(tree);
  try{
    git(capability.source,'archive','--format=tar','--output='+archive,capability.sourceRevision,'--',...selectionPaths);
    execFileSync('tar',['-xf',archive,'-C',tree]);rmSync(archive);
    const selected=await withPackageManager(tree,{workers:1},manager=>identity(tree,{pin:manager.pin,run:args=>{counts.pnpmSelectionCommands++;return manager.run(args);}}));
    const paths=[...new Set([...selected.inputs.map(input=>input.path),...selected.importers.filter(path=>path!=='.')])].sort();
    if(paths.some(path=>!path||path==='.'||isAbsolute(path)||!inside(capability.source,resolve(capability.source,path))))throw Error('oracle dependency install input escapes its source');
    const treeRows=inputRows(capability,[...new Set([...paths,...selectionPaths])].sort(),metadata);
    return {version:1,identity:selected,paths,selectionPaths,treeRows,treeSha256:hash(JSON.stringify({paths,selectionPaths,treeRows}))};
  }finally{rmSync(selection,{recursive:true,force:true});}
}

function validateReadyInputs(capability:DependencyCapability,record:InstallInputs):void{
  const metadata=selectionRows(capability,capability.sourceRevision),selectionPaths=metadata.map(row=>row.slice(row.indexOf('\t')+1));
  if(record?.version!==1||!Array.isArray(record.paths)||!Array.isArray(record.treeRows)||JSON.stringify(record.selectionPaths)!==JSON.stringify(selectionPaths)||
     record.paths.some(path=>typeof path!=='string'||!path||path==='.'||isAbsolute(path)||!inside(capability.source,resolve(capability.source,path)))||
     hash(JSON.stringify({paths:record.paths,selectionPaths:record.selectionPaths,treeRows:record.treeRows}))!==record.treeSha256)
    throw Error('oracle dependency recorded install inputs are invalid');
  if(!record.identity||typeof record.identity!=='object')throw Error('oracle dependency recorded installer identity is missing');
  const {key,...value}=record.identity,pin=managerPin(capability.source);
  if(value.version!==2||value.node!==process.versions.node||value.platform!==process.platform||value.arch!==process.arch||value.pnpm!==pin.version||value.manager!=='sha512.'+pin.sha512||hash(JSON.stringify(value))!==key||!Array.isArray(value.inputs))throw Error('oracle dependency recorded installer identity changed');
  if(JSON.stringify(inputRows(capability,[...new Set([...record.paths,...selectionPaths])].sort(),metadata))!==JSON.stringify(record.treeRows))throw Error('oracle dependency recorded install input rows changed');
  for(const input of value.inputs){
    if(!record.paths.includes(input.path))throw Error('oracle dependency input is outside its recorded path set');
    const file=join(capability.source,input.path),actual=existsSync(file)?hash(readFileSync(file)):'absent';
    if(actual!==input.sha256)throw Error('oracle dependency recorded input bytes changed: '+input.path);
  }
}

export async function sealDependencyCapability(capability:DependencyCapability,env:NodeJS.ProcessEnv,signal?:AbortSignal):Promise<DependencyCapability>{
  signal?.throwIfAborted();
  ownsDependencyRun(capability,env,true);
  if(capability.seal?.nodeVersion===process.versions.node){try{dependencySealReady(capability,env);return capability;}catch(error){throw new ToolingInstrumentError('tooling-setup',String(error));}}
  const unsealed={...capability};delete unsealed.seal;
  const ready=await captureDependencies(unsealed,signal,env),image:DependencyImage=JSON.parse(readFileSync(ready,'utf8'));
  const directory=dirname(ready),semanticBytes=readFileSync(join(directory,'semantic.json')),semantic=JSON.parse(semanticBytes.toString('utf8'));
  const actual=dependencyInventory(join(directory,'tree'));
  const packageMetadata=dependencyPackageInventory(actual).filter((entry):entry is Extract<Entry,{kind:'file'}>=>entry.kind==='file'&&entry.path.endsWith('/package.json')).map(entry=>({path:entry.path,sha256:entry.sha256,metadata:capturedPackageMetadata(dirname(join(directory,'tree',entry.path)))}));
  if(JSON.stringify(actual)!==JSON.stringify(image.entries)||hash(JSON.stringify(actual))!==image.treeSha256||
     JSON.stringify(dependencyPackageInventory(actual))!==JSON.stringify(semantic.packages)||JSON.stringify(packageMetadata)!==JSON.stringify(semantic.packageMetadata))throw new ToolingInstrumentError('tooling-setup','oracle dependency image changed before sealing: '+ready);
  chmodSync(join(directory,'semantic.json'),0o444);chmodSync(ready,0o444);
  const seal:DependencyRunSeal={version:1,nodeVersion:process.versions.node,record:ready,readySha256:hash(readFileSync(ready)),semanticSha256:hash(semanticBytes),identity:dependencySealIdentity(ready)};
  return {...capability,seal};
}
export async function captureDependencies(capability:DependencyCapability,signal?:AbortSignal,env:NodeJS.ProcessEnv=process.env):Promise<string>{
  try{const sealed=dependencySealReady(capability,env);if(sealed)return sealed;}catch(error){throw new ToolingInstrumentError('tooling-setup',String(error));}
  const callStart=performance.now();
  const counts={pnpmSelectionCommands:0};
  checked(capability);
  const ledger=join(capability.admission.kind==='gate'?capability.admission.temporary.parent:capability.directory,'oracle-dependency-calls.jsonl');
  capability={...capability,directory:join(capability.directory,'node-'+process.versions.node)};
  const admission=new TemporaryAdmission({path:capability.directory,context:capability.admission,reservedBytes:CAPTURE_DISK_BYTES,host:hostObservations(env)});
  mkdirSync(capability.directory,{recursive:true});
  const recordCall=(mode:'cold'|'hit'|'held')=>appendFileSync(ledger,JSON.stringify({version:1,step:capability.ownerStep,nodeVersion:process.versions.node,directory:capability.directory,mode,wallMs:performance.now()-callStart,...counts})+'\n');
  let lock:GateResource|null;
  while(!(lock=GateResource.tryAcquire(join(capability.directory,'build.lock')))){
    if(signal?.aborted)throw Error('oracle dependency capture canceled while waiting');await pause(100,undefined,{signal});
  }
  try{
    const ready=join(capability.directory,'ready.json'),failed=join(capability.directory,'failed.json'),started=join(capability.directory,'started.json');
    if(signal?.aborted)throw Error('oracle dependency capture canceled before start');
    if(existsSync(failed)){
      const previous=JSON.parse(readFileSync(failed,'utf8')),reason='oracle dependency capture failed: '+previous.reason;
      throw previous.kind==='case-budget'?new CaseBudgetError(reason):new ToolingInstrumentError('tooling-setup',reason);
    }
    if(existsSync(ready)){
      const image:DependencyImage=JSON.parse(readFileSync(ready,'utf8'));
      const semantic=JSON.parse(readFileSync(join(capability.directory,'semantic.json'),'utf8'));
      if(image.version!==1||image.source!==capability.source||image.lockfileSha256!==capability.lockfileSha256||image.sourceRevision!==capability.sourceRevision||semantic.producerSha256!==capability.producerSha256||JSON.stringify(semantic.inputSet)!==JSON.stringify(image.inputSet))throw Error('oracle dependency ready identity mismatch');
      validateReadyInputs(capability,image.inputSet);
      recordCall('hit');
      return ready;
    }
    // A killed builder cannot authorize another acquisition or a fallback.
    if(existsSync(started))throw Error('oracle dependency capture was interrupted: '+started);
    const selectionStart=performance.now(),inputSet=await installInputs(capability,counts),selectionWallMs=performance.now()-selectionStart;
    publish(started,{capability,started:new Date().toISOString()});
    try{
      let snapshot=admission.check();
      while(!snapshot.admitted){
        if(signal?.aborted)throw new ToolingInstrumentError('tooling-setup','oracle dependency capture canceled during admission');
        await pause(1000,undefined,{signal});
        snapshot=admission.check();
      }
      writeFileSync(join(capability.directory,'admission.json'),JSON.stringify({at:new Date().toISOString(),...snapshot})+'\n');
      const before=performance.now();
      const inputRecord=join(capability.directory,'install-inputs.json');publish(inputRecord,inputSet);
      const inputSha256=hash(readFileSync(inputRecord));
      // The build's memory: inside a gate step, the step's reservation; alone,
      // what earlier captures held, never more than its resident budget.
      let reservation:Awaited<ReturnType<typeof reserveJob>>;
      try{reservation=await reserveJob({key:'oracle-dependency-capture',atMostBytes:CAPTURE_BYTES,what:'oracle dependency capture'},{env,signal,report:message=>process.stderr.write(message+'\n')});}
      catch(error){if(signal?.aborted)throw new ToolingInstrumentError('tooling-setup','oracle dependency capture canceled while it waited for memory');throw error;}
      const memory=new MemoryRun({budgetBytes:CAPTURE_BYTES,id:'oracledependency'+process.pid});
      let run:Awaited<ReturnType<typeof activeCommand>>,peakBytes:number,cpu:Record<string,number>;
      try{
        const worker=memory.worker('build',CAPTURE_BYTES),scope=worker.scope('prlimit',['--core=0','--cpu='+CAPTURE_CPU_SECONDS+':'+(CAPTURE_CPU_SECONDS+1),process.execPath,fileURLToPath(import.meta.url),'--build',JSON.stringify(capability),inputSha256]);
        run=await activeCommand('systemd-run',scope.argv,{cwd:capability.source,env:{...process.env,...scope.env},cpuBudgetSeconds:CAPTURE_CPU_SECONDS,idleMs:120_000,maxBuffer:32*2**20});
        peakBytes=Number(readFileSync('/sys/fs/cgroup'+memory.group+'/memory.peak','utf8'));
        cpu=Object.fromEntries(readFileSync('/sys/fs/cgroup'+memory.group+'/cpu.stat','utf8').trim().split('\n').map(line=>{const [key,value]=line.split(' ');return [key!,Number(value)];}));
        const overBudget=worker.counters().oom>0||run.runaway||run.hung||cpu.usage_usec!>CAPTURE_CPU_SECONDS*1e6;
        writeFileSync(join(capability.directory,'command.json'),JSON.stringify({command:'systemd-run',args:scope.argv,scope:memory.group,peakBytes,residentBudgetBytes:CAPTURE_BYTES,cpuBudgetSeconds:CAPTURE_CPU_SECONDS,...run},null,2)+'\n');
        if(overBudget)throw new CaseBudgetError('oracle dependency capture exceeded its preparation budget: '+(run.runaway??run.hung??'resident memory'));
      }finally{try{memory.close();}finally{if(!reservation.inherited){reservation.release();await reservation.closed;}}}
      writeFileSync(join(capability.directory,'stdout'),run.stdout);writeFileSync(join(capability.directory,'stderr'),run.stderr);
      if(signal?.aborted)throw Error('oracle dependency capture canceled before publication');
      if(run.status!==0||run.signal||run.error||run.hung||run.runaway)throw Error('oracle dependency capture not measured: '+run.out);
      if(JSON.stringify(await installInputs(capability,counts))!==JSON.stringify(inputSet))throw Error('oracle dependency install inputs changed during capture');
      const result=JSON.parse(readFileSync(join(capability.directory,'build-result.json'),'utf8')),entries:Entry[]=result.entries;
      if(!Array.isArray(entries)||!Number.isSafeInteger(result.allocatedBytes)||result.allocatedBytes<1||!Number.isFinite(peakBytes)||peakBytes<=0||!Number.isFinite(cpu.user_usec)||!Number.isFinite(cpu.system_usec))throw Error('oracle dependency cost was not measured');
      if(result.allocatedBytes>CAPTURE_DISK_BYTES)throw new CaseBudgetError('oracle dependency capture exceeded its disk reservation: '+result.allocatedBytes+' > '+CAPTURE_DISK_BYTES);
      const image:DependencyImage={version:1,source:capability.source,sourceRevision:capability.sourceRevision,inputSet,lockfileSha256:capability.lockfileSha256,
        treeSha256:hash(JSON.stringify(entries)),manager:managerPin(capability.source),entries,ownerStep:capability.ownerStep,
        cost:{wallMs:selectionWallMs+performance.now()-before,selectionWallMs,userSeconds:cpu.user_usec!/1e6,systemSeconds:cpu.system_usec!/1e6,bytes:entries.reduce((sum,entry)=>sum+(entry.kind==='file'?entry.bytes:0),0),allocatedBytes:result.allocatedBytes,peakBytes,residentBudgetBytes:CAPTURE_BYTES,cpuBudgetSeconds:CAPTURE_CPU_SECONDS,reservedBytes:CAPTURE_DISK_BYTES}};
      if(signal?.aborted)throw Error('oracle dependency capture canceled before publication');
      const packages=dependencyPackageInventory(entries),included=new Set(packages.map(entry=>entry.path));
      const omittedInstallerPaths=entries.filter(entry=>entry.path.split(sep).includes('node_modules')&&!included.has(entry.path)).map(entry=>entry.path);
      const packageMetadata=packages.filter((entry):entry is Extract<Entry,{kind:'file'}>=>entry.kind==='file'&&entry.path.endsWith('/package.json')).map(entry=>({path:entry.path,sha256:entry.sha256,metadata:capturedPackageMetadata(dirname(join(capability.directory,'tree',entry.path)))}));
      publish(join(capability.directory,'semantic.json'),{version:1,inputSet,lockfileSha256:image.lockfileSha256,manager:image.manager,producerSha256:capability.producerSha256,packages,packageMetadata,omittedInstallerPaths});
      publish(ready,image);
      process.stderr.write('oracle dependency capture: '+JSON.stringify({context:capability.admission.kind,nodeVersion:process.versions.node,...image.cost})+'\n');
      recordCall('cold');
      return ready;
    }catch(error){publish(failed,{kind:error instanceof CaseBudgetError?'case-budget':'tooling-setup',reason:String(error),finished:new Date().toISOString()});throw error;}
  }catch(error){recordCall('held');throw error;}finally{lock.close();}
}

async function build(capability:DependencyCapability,inputSha256:string){
  const inputBytes=readFileSync(join(capability.directory,'install-inputs.json'));
  if(hash(inputBytes)!==inputSha256)throw Error('oracle dependency install input record changed');
  const inputSet:InstallInputs=JSON.parse(inputBytes.toString('utf8'));
  checked(capability);
  if(JSON.stringify(inputRows(capability,[...new Set([...inputSet.paths,...inputSet.selectionPaths])].sort()))!==JSON.stringify(inputSet.treeRows))throw Error('oracle dependency install inputs changed before archive');
  const tree=join(capability.directory,'tree'),archive=join(capability.directory,'source.tar');mkdirSync(tree);
  const present=new Set<string>();
  for(const row of inputSet.treeRows)for(let path=row.slice(row.indexOf('\t')+1);path!=='.';path=dirname(path))present.add(path);
  const paths=inputSet.paths.filter(path=>present.has(path));
  git(capability.source,'archive','--format=tar','--output='+archive,capability.sourceRevision,'--',...paths);
  execFileSync('tar',['-xf',archive,'-C',tree]);rmSync(archive);
  // The existing offline installer enumerates tracked module paths. A fresh
  // archive has none yet; all workspace importers still come from pnpm itself.
  execFileSync('git',['init','--quiet',tree]);
  const common=resolve(capability.source,git(capability.source,'rev-parse','--git-common-dir')),shared=dirname(common);
  if(await installDependencies(shared,tree,{managerWorkers:1,packageImportMethod:'copy',expectedIdentityKey:inputSet.identity.key})!==inputSet.identity.key)throw Error('oracle dependency installed input identity mismatch');
  rmSync(join(tree,'.git'),{recursive:true});
  if(hash(readFileSync(join(tree,'pnpm-lock.yaml')))!==capability.lockfileSha256)throw Error('oracle dependency installed lockfile mismatch');
  const entries=protectDependencyImage(tree),allocatedBytes=lstatSync(tree).blocks*512+entries.reduce((sum,entry)=>sum+lstatSync(join(tree,entry.path)).blocks*512,0);
  publish(join(capability.directory,'build-result.json'),{entries,allocatedBytes});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController();
  process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
  try{
    const [mode,raw,inputSha256]=process.argv.slice(2),capability:DependencyCapability=JSON.parse(raw!);
    if(mode==='--build')await build(capability,inputSha256!);
    else if(mode==='--capture')process.stdout.write(await captureDependencies(capability,controller.signal)+'\n');
    else throw Error('unknown oracle dependency operation');
  }catch(error){console.error(String(error));process.exitCode=2;}
}
