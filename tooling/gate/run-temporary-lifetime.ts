// A run's scratch has one authenticated lifetime, including after SIGKILL.
import {createHash} from 'node:crypto';
import {appendFileSync,closeSync,constants,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,readSync,realpathSync,renameSync,writeFileSync,writeSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {durableRecord} from './durable-record.ts';
import {assertRunTemporary,discardRunTemporary,runTemporaryImageRoots,type RunTemporary} from './run-temporary.ts';
import {hostObservations,HOST_OBSERVATIONS,type HostObservations} from './host-observations.ts';
import {hostEnvironment} from './host-environment.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {assertNoObservedProcessUsers} from '../landing/tree-users.ts';
import {assertNoUnitUsers,assertUnitTreeUnused,type UnitTreeOwnership} from './disk-reclamation.ts';
import {processIdentity} from '../landing/lock.ts';
import {lockStateFile} from './state-file.ts';
import {assertStateVersion} from './state-version.ts';
import {ownUnit,requireOwnUnit} from './scopes/bound-slice.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';

export const RUN_DIAGNOSTIC_BYTES=64*2**20;
export const RUN_DIAGNOSTIC_FILES=4096;
type Identity={path:string;dev:number;ino:number;uid:number};
type Diagnostics={path:string;bytes:number;files:number;capped:boolean;cap_bytes:number;cap_files:number};
type DiagnosticCheckpoint=(phase:'copying'|'prepared'|'published',directory:string)=>void;
type DiagnosticPublication={version:1;stage:string;directory:Identity;manifest_sha256:string;result:Diagnostics};
export type TemporaryDisposition={path:string;state:string;bytes:number;run:string;diagnostics?:Diagnostics};
type Receipt={version:1;token:string;run:string;temporary:RunTemporary;parent:Identity;owner:string;unit:string;invocation:string;backstop:string;diagnostics?:DiagnosticPublication;closed?:TemporaryDisposition};
const TOKEN='.nts-run-token';
const ENTRY=new URL('./run-temporary-lifetime.ts',import.meta.url);
const uuid=(value:unknown):value is string=>typeof value==='string'&&value.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function processBirth(value:unknown):value is string{
  if(typeof value!=='string')return false;
  const parts=value.split(' ');
  return parts.length===3&&uuid(parts[0])&&parts.slice(1).every(text=>{
    const number=Number(text);return Number.isSafeInteger(number)&&number>0&&String(number)===text;
  });
}
const identity=(path:string):Identity=>{
  const s=lstatSync(path);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||realpathSync(path)!==path)throw Error('run temporary parent is not an owned physical directory: '+path);
  return {path,dev:s.dev,ino:s.ino,uid:s.uid};
};
function sameParent(receipt:Receipt):void{
  if(JSON.stringify(identity(receipt.parent.path))!==JSON.stringify(receipt.parent))throw Error('run temporary parent identity changed: '+receipt.run);
}
const diagnosticPath=(r:Receipt)=>join(r.run,'diagnostics-'+r.token);
const diagnosticStagePrefix=(r:Receipt)=>'.nts-diagnostics-'+r.token+'-';
function diagnosticShape(value:Diagnostics|undefined,path:string):boolean{
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&value.path===path&&typeof value.capped==='boolean'&&
    [value.bytes,value.files,value.cap_bytes,value.cap_files].every(n=>Number.isSafeInteger(n)&&n>=0)&&
    value.bytes<=value.cap_bytes&&value.files<=value.cap_files&&value.cap_bytes<=RUN_DIAGNOSTIC_BYTES&&value.cap_files<=RUN_DIAGNOSTIC_FILES);
}
function readReceipt(file:string,token?:string):Receipt{
  const s=lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||s.nlink!==1)throw Error('run temporary receipt is not an owned regular file: '+file);
  const r=JSON.parse(readFileSync(file,'utf8')) as Receipt;assertStateVersion(r,1,file);
  if(!r||typeof r!=='object'||Array.isArray(r)||r.version!==1||!uuid(r.token)||token!==undefined&&r.token!==token||
    basename(file)!=='temporary-owner-'+r.token+'.json'||r.run!==dirname(file)||r.parent?.path!==r.run||r.temporary?.path!==join(r.run,'tmp')||!processBirth(r.owner)||
    r.temporary.creation?.token!==r.token||r.temporary.creation.parentDev!==r.parent.dev||r.temporary.creation.parentIno!==r.parent.ino||
    typeof r.unit!=='string'||!/^[a-zA-Z0-9_.:@-]+\.(?:service|scope)$/.test(r.unit)||
    typeof r.invocation!=='string'||!/^[a-f0-9]{32}$/.test(r.invocation)||r.backstop!==`nts-tmp${r.token.replaceAll('-','')}.service`)
    throw Error('invalid run temporary identity/token: '+file);
  if(r.closed!==undefined&&(!r.closed||typeof r.closed!=='object'||Array.isArray(r.closed)||r.closed.path!==r.temporary.path||r.closed.run!==r.run||
    !Number.isSafeInteger(r.closed.bytes)||r.closed.bytes<0||!['removed after green','removed after red','already absent'].includes(r.closed.state)))
    throw Error('invalid closed run temporary identity: '+file);
  if(r.diagnostics!==undefined){
    const d=r.diagnostics;assertStateVersion(d,1,file+' diagnostics');
    if(!d||typeof d!=='object'||Array.isArray(d)||d.version!==1||typeof d.stage!=='string'||dirname(d.stage)!==r.temporary.path||
      !basename(d.stage).startsWith(diagnosticStagePrefix(r))||d.directory?.path!==d.stage||d.directory.dev!==r.temporary.dev||d.directory.uid!==r.parent.uid||
      !Number.isSafeInteger(d.directory.ino)||d.directory.ino<=0||typeof d.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(d.manifest_sha256)||
      !diagnosticShape(d.result,diagnosticPath(r)))throw Error('invalid diagnostic publication identity: '+file);
  }
  sameParent(r);return r;
}
function sameTemporary(r:Receipt,home:string):void{
  sameParent(r);assertRunTemporary(r.temporary,home);
  const file=join(r.temporary.path,TOKEN),s=lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==r.parent.uid||readFileSync(file,'utf8')!==r.token)throw Error('run temporary token changed: '+r.run);
}
function control(args:string[]):string{
  return infrastructureProbe({purpose:'run temporary lifetime',command:'systemctl',args:['--user',...args]}).stdout.trim();
}
function syncDirectory(path:string):void{
  const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}
function verifyDiagnosticPublication(r:Receipt,at:string):Diagnostics{
  const d=r.diagnostics!,actual=identity(at),manifest=join(at,'manifest.json'),info=lstatSync(manifest);
  if(actual.dev!==d.directory.dev||actual.ino!==d.directory.ino||actual.uid!==d.directory.uid||
    !info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.uid!==r.parent.uid||
    createHash('sha256').update(readFileSync(manifest)).digest('hex')!==d.manifest_sha256)
    throw Error('diagnostic publication was replaced: '+at);
  return d.result;
}
function publishDiagnostics(r:Receipt,home:string):Diagnostics{
  const d=r.diagnostics!,path=d.result.path;sameTemporary(r,home);
  if(lstatSync(path,{throwIfNoEntry:false})){
    verifyDiagnosticPublication(r,path);
    if(lstatSync(d.stage,{throwIfNoEntry:false}))throw Error('diagnostic publication has both staged and published roots: '+r.run);
    return d.result;
  }
  verifyDiagnosticPublication(r,d.stage);sameTemporary(r,home);renameSync(d.stage,path);
  syncDirectory(r.run);syncDirectory(r.temporary.path);return verifyDiagnosticPublication(r,path);
}
/** Files are a bounded diagnostic fallback, never a retained dependency image.
 * Relative paths preserve failing inputs, stderr, generated reproducers and any
 * existing core. Symlinks and sockets are never followed. */
function retainDiagnostics(file:string,r:Receipt,home:string,capBytes:number,capFiles:number,checkpoint?:DiagnosticCheckpoint):Diagnostics{
  if(r.diagnostics)return publishDiagnostics(r,home);
  const path=diagnosticPath(r),result:Diagnostics={path,bytes:0,files:0,capped:false,cap_bytes:capBytes,cap_files:capFiles};
  if(!diagnosticShape(result,path))throw Error('invalid diagnostic retention bounds: '+r.run);
  if(lstatSync(path,{throwIfNoEntry:false}))throw Error('unregistered diagnostic publication: '+path);
  const stage=mkdtempSync(join(r.temporary.path,diagnosticStagePrefix(r)));mkdirSync(join(stage,'files'),{mode:0o700});
  checkpoint?.('copying',stage);
  const excluded=runTemporaryImageRoots(r.temporary,home);
  excluded.push(join(r.temporary.path,'.nts-oracle-images-v1'),join(r.temporary.path,TOKEN));
  const skip=new Set(excluded.map(path=>Buffer.from(path).toString('hex'))),root=Buffer.from(r.temporary.path),slash=Buffer.from('/');
  const walk=(source:Buffer):void=>{
    for(const name of readdirSync(source,{encoding:'buffer'}).sort(Buffer.compare)){
      // Interrupted attempts are disposable copies inside this authenticated
      // tmp, never source diagnostics and never separately retained evidence.
      if(source.equals(root)&&name.subarray(0,Buffer.byteLength(diagnosticStagePrefix(r))).equals(Buffer.from(diagnosticStagePrefix(r))))continue;
      const from=Buffer.concat([source,slash,name]);
      if(skip.has(from.toString('hex')))continue;
      if(result.files>=capFiles||result.bytes>=capBytes){result.capped=true;return;}
      const s=lstatSync(from);
      if(s.isSymbolicLink())continue;
      if(s.isDirectory()){walk(from);continue;}
      if(!s.isFile()||s.uid!==r.parent.uid)continue;
      if(s.size>capBytes-result.bytes){result.capped=true;continue;}
      sameTemporary(r,home);
      const fd=openSync(from,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{
        const actual=fstatSync(fd);
        if(actual.dev!==s.dev||actual.ino!==s.ino||actual.size!==s.size)throw Error('diagnostic changed during close: '+from);
        const to=Buffer.concat([Buffer.from(join(stage,'files')),slash,from.subarray(root.length+1)]);
        mkdirSync(to.subarray(0,to.lastIndexOf(47)),{recursive:true});
        const output=openSync(to,'wx',0o600);
        try{
          const buffer=Buffer.alloc(Math.min(64*1024,s.size));let copied=0;
          while(copied<s.size){
            const n=readSync(fd,buffer,0,Math.min(buffer.length,s.size-copied),null);if(!n)throw Error('diagnostic truncated during close: '+from);
            let written=0;while(written<n){const count=writeSync(output,buffer,written,n-written);if(!count)throw Error('diagnostic write made no progress');written+=count;}
            copied+=n;
          }
          if(fstatSync(fd).size!==s.size)throw Error('diagnostic changed during close: '+from);
          fsyncSync(output);result.bytes+=copied;result.files++;
        }finally{closeSync(output);}
      }finally{closeSync(fd);}
    }
  };
  walk(root);
  durableRecord(join(stage,'manifest.json'),{version:1,run:r.run,token:r.token,original_root:r.temporary.path,...result,
    retained:['failing inputs','stderr','reproducers','existing cores'],excluded,mapping:'original_root/<relative path bytes> -> path/files/<relative path bytes>'});
  r.diagnostics={version:1,stage,directory:identity(stage),manifest_sha256:createHash('sha256').update(readFileSync(join(stage,'manifest.json'))).digest('hex'),result};
  durableRecord(file,r);checkpoint?.('prepared',stage);
  const published=publishDiagnostics(r,home);checkpoint?.('published',published.path);return published;
}
/** Shared by the normal drain and the unit's ExecStop. A closed receipt is
 * idempotent only while its tmp remains absent; it never authorizes a new root. */
export function closeRunTemporary(file:string,token:string,home:string,green:boolean,host:HostObservations|undefined,
  options:{backstop?:boolean;capBytes?:number;capFiles?:number;units?:readonly UnitTreeOwnership[];log?:(line:string)=>void;checkpoint?:DiagnosticCheckpoint}={}):TemporaryDisposition{
  const unlock=lockStateFile(file);if(!unlock)throw Error('run temporary receipt stayed locked: '+file);
  try{
    const r=readReceipt(file,token),log=options.log??(line=>{appendFileSync(join(r.run,'temporary.log'),line+'\n');process.stderr.write(line+'\n');});
    if(r.closed){if(lstatSync(r.temporary.path,{throwIfNoEntry:false}))throw Error('closed run temporary is present again: '+r.run);return r.closed;}
    if(options.backstop){
      if(ownUnit()!==r.backstop)throw Error('run temporary backstop unit mismatch: '+r.run);
      const current=control(['show',r.unit,'--property=InvocationID','--value']);
      if(current&&current!==r.invocation)throw Error('run temporary owner unit invocation changed: '+r.run);
      const state=control(['show',r.unit,'--property=ActiveState','--value']);
      if(!['inactive','failed'].includes(state))throw Error('run temporary owner unit has not ended: '+r.run+'; '+r.unit+' '+state);
      const pid=Number(r.owner.split(' ')[1]);
      if(processIdentity(pid)===r.owner)throw Error('run temporary owner is still alive: '+r.run);
    }
    if(!lstatSync(r.temporary.path,{throwIfNoEntry:false})){
      const diagnostics=r.diagnostics?verifyDiagnosticPublication(r,r.diagnostics.result.path):undefined;
      const closed:TemporaryDisposition={path:r.temporary.path,state:'already absent',bytes:0,run:r.run,...(diagnostics?{diagnostics}:{})};
      durableRecord(file,{...r,closed});return closed;
    }
    sameTemporary(r,home);
    host??=hostObservations();
    const assertUnused=()=>{
      assertNoObservedProcessUsers(host!.processUsers([r.temporary.path]));
      if(options.units)for(const unit of options.units)assertUnitTreeUnused([r.temporary.path],unit);
      else{
        const units=host!.unitUsers();
        if(units.kind==='live')assertNoUnitUsers([r.temporary.path]);
        else for(const unit of units.units)assertUnitTreeUnused([r.temporary.path],unit);
      }
    };
    assertUnused();
    const diagnostics=green&&!r.diagnostics?undefined:retainDiagnostics(file,r,home,options.capBytes??RUN_DIAGNOSTIC_BYTES,options.capFiles??RUN_DIAGNOSTIC_FILES,options.checkpoint);
    if(diagnostics?.capped)log(`gate tmp: diagnostic cap hit: run=${r.run} bytes=${diagnostics.bytes} files=${diagnostics.files} cap_bytes=${diagnostics.cap_bytes} cap_files=${diagnostics.cap_files}`);
    const measured=infrastructureProbe({purpose:'run temporary allocated bytes',command:'du',args:['-sx','-B1','--',r.temporary.path]}).stdout;
    const bytes=Number(measured.split('\t')[0]);if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('invalid run temporary bytes: '+r.run);
    sameTemporary(r,home);
    assertUnused();
    log(`gate tmp: removing run=${r.run} path=${r.temporary.path} bytes=${bytes}`);
    discardRunTemporary(r.temporary,home,host);
    const closed:TemporaryDisposition={path:r.temporary.path,state:green?'removed after green':'removed after red',bytes,run:r.run,...(diagnostics?{diagnostics}:{})};
    durableRecord(file,{...r,closed});
    log(`gate tmp: removed run=${r.run} path=${r.temporary.path} bytes=${bytes}`);return closed;
  }finally{unlock();}
}

/** Arm before starting work. Nested launchers borrow exactly this token; the
 * creator owns disarming, and every borrower can join the same guarded close. */
export function ownRunTemporary(temporary:RunTemporary,env:NodeJS.ProcessEnv,host:HostObservations){
  const home=env.HOME!;assertRunTemporary(temporary,home);
  if(!temporary.creation)throw Error('run temporary was not created for this lifetime: '+temporary.path);
  const file=join(temporary.parent,'temporary-owner-'+temporary.creation.token+'.json');
  let r:Receipt,created=false;
  if(existsSync(file)&&!readReceipt(file).closed){r=readReceipt(file);sameTemporary(r,home);
    if(r.temporary.dev!==temporary.dev||r.temporary.ino!==temporary.ino)throw Error('run temporary handoff changed: '+file);
    if(processIdentity(Number(r.owner.split(' ')[1]))!==r.owner)throw Error('run temporary owner has ended: '+file);
  }else{
    const unit=requireOwnUnit(),owner=processIdentity(process.pid);if(!owner)throw Error('run temporary owner identity unavailable');
    const parent=identity(temporary.parent),creation=temporary.creation;
    if(!creation||creation.parentDev!==parent.dev||creation.parentIno!==parent.ino)throw Error('run temporary was not created for this lifetime: '+temporary.path);
    const token=creation.token,invocation=control(['show',unit,'--property=InvocationID','--value']);
    r={version:1,token,run:temporary.parent,temporary,parent:identity(temporary.parent),owner,unit,invocation,backstop:`nts-tmp${token.replaceAll('-','')}.service`};
    writeFileSync(join(temporary.path,TOKEN),token,{flag:'wx',mode:0o400});durableRecord(file,r);readReceipt(file,token);
    const args=[process.execPath,fileURLToPath(ENTRY),file,token,home],environment=Object.entries(hostEnvironment(env)).flatMap(([key,value])=>value===undefined?[]:[key+'='+value]);
    if(env[HOST_OBSERVATIONS])environment.push(HOST_OBSERVATIONS+'='+env[HOST_OBSERVATIONS]);
    const properties=[['Type','s','oneshot'],['RemainAfterExit','b','true'],['CollectMode','s','inactive-or-failed'],
      ['BindsTo','as','1',unit],['Before','as','1',unit],['LimitCORE','t','0'],['Nice','i','19'],['CPUWeight','t','20'],
      ['TimeoutStopUSec','t','300000000'],['WorkingDirectory','s',dirname(fileURLToPath(ENTRY))],['Environment','as',String(environment.length),...environment],
      ['ExecStart','a(sasb)','1','/usr/bin/true','1','/usr/bin/true','false'],
      ['ExecStopPost','a(sasb)','1',process.execPath,String(args.length),...args,'false']];
    try{
      infrastructureProbe({purpose:'arm run temporary backstop',command:'busctl',args:['--user','call','org.freedesktop.systemd1','/org/freedesktop/systemd1',
        'org.freedesktop.systemd1.Manager','StartTransientUnit','ssa(sv)a(sa(sv))',r.backstop,'fail',String(properties.length),...properties.flat(),'0']});
      // StartTransientUnit returns a job, not activation completion. Work must
      // not reach readiness while a forced stop could still cancel that job.
      control(['start',r.backstop]);
      if(control(['show',r.backstop,'--property=ActiveState','--value'])!=='active')throw Error('run temporary backstop did not activate: '+r.run);
    }catch(primary){
      try{closeRunTemporary(file,token,home,false,host);control(['stop','--no-block',r.backstop]);}
      catch(cleanup){throw new AggregateError([primary,cleanup],'run temporary backstop setup and cleanup failed');}
      throw primary;
    }
    created=true;
  }
  return {file,token:r.token,close(green:boolean){
    const result=closeRunTemporary(file,r.token,home,green,host,{log:line=>appendFileSync(join(r.run,'temporary.log'),line+'\n')});
    if(created)control(['stop','--no-block',r.backstop]);return result;
  }};
}

runAsCommand(import.meta.url,()=>{
  const [file,token,home]=process.argv.slice(2);
  if(!file||!token||!home)throw Error('run temporary backstop needs receipt, token and home');
  if(!lstatSync(file,{throwIfNoEntry:false})&&!lstatSync(join(dirname(file),'tmp'),{throwIfNoEntry:false})){
    process.stderr.write('gate tmp: backstop has no remaining temporary: run='+dirname(file)+'\n');return;
  }
  closeRunTemporary(file,token,home,false,undefined,{backstop:true});
});
