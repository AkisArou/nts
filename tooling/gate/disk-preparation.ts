// Receipts for writers predating the capacity generation. No directory walk,
// Git command or payload read is needed to validate one under the pool lock.
import {closeSync,constants,fsyncSync,fstatSync,lstatSync,openSync,readFileSync,readSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {durableRecord} from './durable-record.ts';
import type {Stats} from 'node:fs';

const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
type Identity={dev:number;ino:number;uid:number;mode:number;size:number};
const identity=(info:Stats):Identity=>({dev:info.dev,ino:info.ino,uid:info.uid,mode:info.mode,size:info.size});
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Both v1 and current claim writers use durableRecord's atomic rename. Hold
 * the observed inode open so it cannot be recycled during preparation. The
 * complete bytes (every claim and identity) are observed outside the lock;
 * its immutable publication identity is a constant-size validation inside. */
export class ClaimReceipt {
  private readonly files:{path:string;fd:number|null;identity:Identity|null;bytes:string|null}[]=[];
  constructor(paths:readonly string[]){
    try{for(const path of paths){
      let fd:number;
      try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(missing(error)){this.files.push({path,fd:null,identity:null,bytes:null});continue;}throw error;}
      const row={path,fd,identity:null as Identity|null,bytes:null as string|null};this.files.push(row);
      const info=fstatSync(fd);row.identity=identity(info);
      if(!info.isFile())throw Error('non-file disk claim publication: '+path);
      row.bytes=readFileSync(fd,'utf8');
    }}catch(error){this.close();throw error;}
  }
  valid():boolean{return this.files.every(row=>{
    try{const current=identity(lstatSync(row.path));return row.identity!==null&&equal(current,row.identity);}
    catch(error){if(missing(error))return row.identity===null;throw error;}
  });}
  close():void{for(const row of this.files)if(row.fd!==null){const fd=row.fd;row.fd=null;closeSync(fd);}}
}

type Metadata={path:string;identity:Identity|null;bytes:string|null};
const MAX_METADATA_BYTES=64*1024;
function metadata(path:string,contents=true):Metadata{
  let info:Stats;
  try{info=lstatSync(path);}catch(error){if(missing(error))return {path,identity:null,bytes:null};throw error;}
  if(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory())throw Error('non-regular Git identity metadata: '+path);
  if(!contents||info.isDirectory())return {path,identity:identity(info),bytes:null};
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const actual=fstatSync(fd);
    if(!actual.isFile()||actual.size>MAX_METADATA_BYTES)throw Error('oversized Git identity metadata: '+path);
    const buffer=Buffer.alloc(Math.min(Number(actual.size)+1,MAX_METADATA_BYTES+1)),length=readSync(fd,buffer,0,buffer.length,0);
    if(length>MAX_METADATA_BYTES)throw Error('oversized Git identity metadata: '+path);
    return {path,identity:identity(actual),bytes:buffer.subarray(0,length).toString('base64')};
  }finally{closeSync(fd);}
}
// Directory size changes with index locks and ordinary file activity. Lease
// identity needs its inode, not the population of that directory.
function leaseMetadata(row:Metadata){
  if(!row.identity||(row.identity.mode&constants.S_IFMT)!==constants.S_IFDIR)return row;
  const {size,...inode}=row.identity;return {...row,identity:inode};
}
const text=(row:Pick<Metadata,'bytes'>):string|null=>row.bytes===null?null:Buffer.from(row.bytes,'base64').toString('utf8');
export type CheckoutMove={gitDir:string;common:string;head:string;dotgit:string;directory:Identity};
export type GitRegistration={root:string;gitDir:string;common:string};

/** Pool membership is Git's shallow administrative namespace. Legacy take
 * publishes no claim or generation, so both its entry and its small linking
 * files must be compared. No checkout contents or Git process is involved. */
function poolMembership(tree:string,readNames:(path:string)=>string[]){
  tree=resolve(tree);
  const dotgit=leaseMetadata(metadata(join(tree,'.git'))),pointer=text(dotgit);
  if(dotgit.identity===null)throw Error('missing pool Git identity: '+tree);
  const gitDir=pointer===null?join(tree,'.git'):resolve(tree,/^gitdir: ([^\r\n]+)\r?\n?$/.exec(pointer)?.[1]??(()=>{throw Error('invalid pool Git pointer: '+tree);})());
  const commonFile=leaseMetadata(metadata(join(gitDir,'commondir'))),common=resolve(gitDir,text(commonFile)?.trim()??'.');
  let unstable=false;
  const read=(path:string,contents=true)=>{
    try{return leaseMetadata(metadata(path,contents));}
    catch(error){
      if(!missing(error)&&(error as NodeJS.ErrnoException).code!=='ENOTDIR')throw error;
      unstable=true;return {path,identity:null,bytes:null};
    }
  };
  const directory=read(join(common,'worktrees'),false);
  let names:string[]=[];
  if(directory.identity!==null){
    try{names=readNames(directory.path).sort();}
    catch(error){if(!missing(error)&&(error as NodeJS.ErrnoException).code!=='ENOTDIR')throw error;unstable=true;}
  }
  const entries=names.map(name=>{
    const path=join(directory.path,name),entry=read(path,false);
    if(!entry.identity)unstable=true;
    if(!entry.identity||(entry.identity.mode&constants.S_IFMT)!==constants.S_IFDIR)
      return {name,entry,gitdir:null,head:null,locked:null,target:null};
    const gitdir=read(join(path,'gitdir')),head=read(join(path,'HEAD')),locked=read(join(path,'locked'));
    const target=text(gitdir)?.trim();
    // Git's get_linked_worktree skips missing/empty gitdir files. Keep their
    // partial metadata in the receipt so completion still invalidates it.
    return {name,entry,gitdir,head,locked,target:target?resolve(path,target):null};
  });
  return {dotgit,commonFile,directory,entries,unstable};
}
export class PoolMembershipReceipt {
  private readonly tree:string;
  private readonly readNames:(path:string)=>string[];
  private readonly value:ReturnType<typeof poolMembership>;
  constructor(tree:string,readNames:(path:string)=>string[]=path=>readdirSync(path)){
    this.tree=tree;this.readNames=readNames;this.value=poolMembership(tree,readNames);
  }
  get entryCount():number{return this.value.entries.length;}
  roots(pool:string):string[]{
    return this.registrations(pool).map(row=>row.root);
  }
  registrations(pool:string):GitRegistration[]{
    pool=resolve(pool);
    return this.value.entries.flatMap(row=>{
      if(row.target===null)return [];
      const root=row.target.endsWith('/.git')?dirname(row.target):row.target;
      return dirname(root)===pool&&/^[1-9][0-9]*$/.test(root.slice(pool.length+1))
        ?[{root,gitDir:row.entry.path,common:dirname(this.value.directory.path)}]:[];
    });
  }
  recheck():{valid:boolean;entries:number}{
    const current=poolMembership(this.tree,this.readNames);
    return {valid:!this.value.unstable&&!current.unstable&&equal(current,this.value),entries:current.entries.length};
  }
}

/** Only fixed, small authoritative files are reread at commit. packed-refs
 * and index publications are compared by identity, never scanned there. */
export class GitReceipt {
  private readonly files:{value:Metadata;contents:boolean}[]=[];
  private readonly purpose:'candidate'|'lease';
  private unstable=false;
  readonly checkout:CheckoutMove|undefined;
  constructor(tree:string,extraFiles:readonly string[]=[],purpose:'candidate'|'lease'='candidate',registration?:GitRegistration){
    this.purpose=purpose;
    tree=resolve(tree);
    const add=(path:string,contents=true):Metadata=>{
      let value:Metadata;
      try{value=metadata(path,contents);}catch(error){
        if(purpose!=='lease'||!missing(error)&&(error as NodeJS.ErrnoException).code!=='ENOTDIR')throw error;
        this.unstable=true;value={path,identity:null,bytes:null};
      }
      this.files.push({value,contents});return value;
    };
    add(tree,false);const dotgit=add(join(tree,'.git'));
    add(tree+'.worker.json');
    if(purpose==='candidate')for(const file of [join(tree,'Cargo.toml'),join(tree,'rust-toolchain.toml'),...extraFiles])add(file);
    if(dotgit.identity===null&&(purpose==='candidate'||!registration))return;
    const pointer=text(dotgit);
    // A grow writes the working tree's pointer outside .lock. Lease identity
    // comes from the captured registration even while that pointer is empty.
    const gitDir=purpose==='lease'&&registration?registration.gitDir:
      pointer===null?join(tree,'.git'):resolve(tree,/^gitdir: ([^\r\n]+)\r?\n?$/.exec(pointer)?.[1]??(()=>{throw Error('invalid worktree Git pointer: '+tree);})());
    const directory=add(gitDir,false),commonFile=add(join(gitDir,'commondir'));
    const common=purpose==='lease'&&registration?registration.common:resolve(gitDir,text(commonFile)?.trim()??'.');
    add(common,false);add(join(gitDir,'gitdir'));add(join(gitDir,'locked'));
    if(purpose==='candidate')add(join(gitDir,'index'),false);
    add(join(common,'packed-refs'),false);
    const head=add(join(gitDir,'HEAD')),headText=text(head);
    if(!headText){
      if(purpose==='candidate')throw Error('missing worktree HEAD: '+tree);
      return;
    }
    const ref=headText===null?undefined:/^ref: (refs\/[^\r\n]+)\r?\n?$/.exec(headText)?.[1];
    if(ref){
      if(ref.split('/').some(part=>!part||part==='.'||part==='..')){
        if(purpose==='candidate')throw Error('invalid worktree HEAD ref: '+tree);
        return;
      }
      add(join(common,ref));
      if(ref.startsWith('refs/heads/'))add(join(common,'refs/nts/landed',ref.slice('refs/heads/'.length)));
    }
    if(purpose==='candidate')add(join(common,'refs/heads/main'));
    if(purpose==='candidate'&&headText!==null&&pointer!==null&&directory.identity&&dirname(gitDir)===join(common,'worktrees'))
      this.checkout={gitDir,common,head:headText,dotgit:pointer,directory:directory.identity};
  }
  valid():boolean{return !this.unstable&&this.files.every(({value,contents})=>{
    try{
      const current=metadata(value.path,contents);
      return this.purpose==='lease'?equal(leaseMetadata(current),leaseMetadata(value)):equal(current,value);
    }catch(error){if(missing(error)||(error as NodeJS.ErrnoException).code==='ENOTDIR')return false;throw error;}
  });}
}

/** Git's move primitive is one rename followed by these two linking-file
 * writes. Its discovery, index/submodule checks and pathname validation must
 * already have completed outside the lock. No Git subprocess runs here. */
export function linkMovedCheckout(move:CheckoutMove,destination:string):void{
  for(const [path,bytes] of [[join(move.gitDir,'gitdir'),join(destination,'.git')+'\n'],[join(destination,'.git'),'gitdir: '+move.gitDir+'\n']]){
    const fd=openSync(path!,'w');try{writeFileSync(fd,bytes!);fsyncSync(fd);}finally{closeSync(fd);}
  }
}

export function syncDiskDirectory(path:string):void{
  const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}

/** Render and fsync all record bytes during preparation. Commit publishes
 * that prepared inode with one rename and fixed directory synchronization. */
export class DetachRecord {
  readonly pending:string;readonly path:string;
  constructor(path:string,value:unknown){this.path=path;this.pending=join(dirname(path),'manifest.detached.json');durableRecord(this.pending,value);}
  publish():void{renameSync(this.pending,this.path);syncDiskDirectory(dirname(this.path));syncDiskDirectory(dirname(dirname(this.path)));}
  close():void{rmSync(this.pending,{force:true});}
}

export function readCheckoutMove(value:unknown,root:string):CheckoutMove{
  const row=value as CheckoutMove;
  if(!row||typeof row!=='object'||typeof row.gitDir!=='string'||resolve(row.gitDir)!==row.gitDir||
    typeof row.common!=='string'||resolve(row.common)!==row.common||dirname(row.gitDir)!==join(row.common,'worktrees')||
    typeof row.head!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})\r?\n?$/.test(row.head)||
    typeof row.dotgit!=='string'||row.dotgit.length>MAX_METADATA_BYTES||!row.directory||
    ['dev','ino','uid','mode','size'].some(key=>!Number.isSafeInteger(row.directory[key as keyof Identity])||row.directory[key as keyof Identity]<0))
    throw Error('invalid disk checkout relocation: '+root);
  const pointer=/^gitdir: ([^\r\n]+)\r?\n?$/.exec(row.dotgit)?.[1];
  if(!pointer||resolve(root,pointer)!==row.gitDir)throw Error('invalid disk checkout pointer: '+root);
  return row;
}

/** A prepared manifest owns a payload even if the process died between its
 * rename and linking-file publication. Repair only those two exact links,
 * never a new registration or a changed HEAD/admin-directory identity. */
export function prepareCheckoutRepair(move:CheckoutMove,root:string,payload:string,common:string):()=>void{
  if(move.common!==common)throw Error('disk checkout belongs to another Git repository: '+payload);
  const paths=[move.gitDir,join(move.gitDir,'HEAD'),join(move.gitDir,'gitdir'),join(payload,'.git')];
  const observed=paths.map(path=>metadata(path));
  if(!equal(observed[0]!.identity,move.directory)||text(observed[1]!)!==move.head)throw Error('disk checkout registration identity changed: '+payload);
  const backlink=text(observed[2]!)?.trim(),pointer=text(observed[3]!);
  if(!backlink||![join(root,'.git'),join(payload,'.git')].includes(resolve(move.gitDir,backlink))||
    pointer!==move.dotgit&&pointer!=='gitdir: '+move.gitDir+'\n')throw Error('disk checkout linking files changed: '+payload);
  return ()=>{
    if(!observed.every(row=>equal(metadata(row.path),row)))throw Error('disk checkout repair observation changed: '+payload);
    linkMovedCheckout(move,payload);
  };
}
