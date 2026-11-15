// Interpret a captured request, never its result or its coverage. The caller
// authenticates versioned/raw/observer receipts before applying this ABI recipe.
import {classifyInputOpen,type RuntimeObservation,type InputSubject} from './rust-test-inputs.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';
import {inputAtFlags} from './rust-input-abi.ts';

export type InputFollowing='follow'|'no-follow'|'descriptor';
export type InputRequirement={kind:'unknown';reason:string}|{kind:'literal';text:string}
  |{kind:'content'|'execute'|'hard-link-source'|'enumeration'|'readlink';following:InputFollowing}
  |{kind:'metadata';query:'stat'|'permission'|'directory'|'path'|'chdir';following:InputFollowing}
  |{kind:'mutation';role:'open'|'temporary-file'|'link-destination'|'rename-source'|'rename-destination'|'remove'|'mkdir'|'truncate';following:InputFollowing;readsContent:boolean};
type Request=Pick<RuntimeObservation,'syscall'|'operation'|'args'>;
const unknown=(reason:string):InputRequirement=>({kind:'unknown',reason});

/** Linux man-pages describe flags independently for each syscall:
 * https://man7.org/linux/man-pages/man2/statx.2.html
 * https://man7.org/linux/man-pages/man2/open.2.html
 * https://man7.org/linux/man-pages/man2/execveat.2.html
 * Literal arguments are not filesystem reads. Every later descriptor access
 * still needs its own requirement and claim. */
export function runtimeInputRequirement(row:Request,subject:InputSubject,observer:FileObserverReceipt|null):InputRequirement{
  if(!observer)return unknown('missing authenticated capture ABI');
  if(observer.abi!=='linux-x86_64-v1')return unknown('syscall recipe is not implemented for '+observer.abi);
  const scalar=(arg:number):bigint|undefined=>{
    const value=row.args[arg];return value!==undefined&&/^[0-9a-f]{1,16}$/.test(value)?BigInt('0x'+value):undefined;
  };
  const path=(arg:number,dirfd=-1)=>subject.kind==='path'?subject.arg===arg&&subject.dirfdArg===dirfd:
    subject.pathArgument?.arg===arg&&subject.pathArgument.dirfdArg===dirfd&&subject.arg===dirfd;
  const descriptor=(arg:number)=>subject.kind==='descriptor'&&subject.arg===arg&&subject.fd>=0&&!subject.pathArgument;
  const empty=()=>subject.kind==='descriptor'?!!subject.pathArgument:subject.name==='';
  const flags=(arg:number,mask:bigint):bigint|undefined=>{
    const value=scalar(arg);return value!==undefined&&(value&~mask)===0n?value:undefined;
  };
  const following=(value:bigint,nofollow=0x100n):InputFollowing=>empty()?'descriptor':(value&nofollow)!==0n?'no-follow':'follow';
  const metadata=(query:'stat'|'permission'|'directory'|'path'|'chdir',follow:InputFollowing):InputRequirement=>({kind:'metadata',query,following:follow});
  const mutation=(role:Extract<InputRequirement,{kind:'mutation'}>['role'],follow:InputFollowing,readsContent=false):InputRequirement=>({kind:'mutation',role,following:follow,readsContent});
  if(row.operation==='open'){
    if(!path(row.syscall==='open'?0:1,row.syscall==='open'?-1:0))return unknown('open subject position mismatch');
    const access=classifyInputOpen(row,observer);
    if(access.kind==='unknown')return unknown(access.reason);
    const value=BigInt('0x'+access.flags!);
    if(empty())return unknown('open pathname is empty or null');
    if((value&0x200000n)!==0n&&(value&0x400000n)!==0n)return unknown('mixed path-only and temporary-file flags');
    const follow=(value&0xc0n)===0xc0n?'no-follow':following(value,0x20000n);
    if(access.kind==='content-read')return {kind:'content',following:follow};
    if(access.kind==='directory')return metadata('directory',follow);
    if(access.kind==='path')return metadata('path',follow);
    const temporary=(value&0x400000n)!==0n;
    return mutation(temporary?'temporary-file':'open',follow,!temporary&&(value&3n)!==1n);
  }
  switch(row.syscall){
    case 'stat':case 'lstat':
      return row.operation==='lookup'&&path(0)&&!empty()?metadata('stat',row.syscall==='stat'?'follow':'no-follow'):unknown('stat subject mismatch');
    case 'newfstatat':case 'fstatat':case 'statx':{
      if(row.operation!=='lookup'||!path(1,0))return unknown('stat-at subject position mismatch');
      const value=inputAtFlags(row);
      if(value===undefined)return unknown('unknown stat-at flags');
      if(empty()&&(value&0x1000n)===0n)return unknown('empty stat pathname without AT_EMPTY_PATH');
      return metadata('stat',following(value));
    }
    case 'access':case 'faccessat':case 'faccessat2':{
      const at=row.syscall!=='access';
      if(row.operation!=='lookup'||!path(at?1:0,at?0:-1))return unknown('access subject position mismatch');
      if(flags(at?2:1,7n)===undefined)return unknown('unknown access mode');
      const value=row.syscall==='faccessat2'?inputAtFlags(row):0n;
      if(value===undefined||subject.kind==='descriptor'&&(!subject.pathArgument||subject.pathArgument.value.null))return unknown('unknown access flags or null pathname');
      if(empty()&&(value&0x1000n)===0n)return unknown('empty access pathname without AT_EMPTY_PATH');
      return metadata('permission',following(value));
    }
    case 'readlink':case 'readlinkat':
      if(row.operation!=='lookup'||!path(row.syscall==='readlink'?0:1,row.syscall==='readlink'?-1:0))return unknown('readlink subject position mismatch');
      if(subject.kind==='descriptor'&&(!subject.pathArgument||subject.pathArgument.value.null)||empty()&&row.syscall!=='readlinkat')return unknown('invalid null or empty readlink pathname');
      return {kind:'readlink',following:empty()?'descriptor':'no-follow'};
    case 'fstat':return row.operation==='descriptor'&&descriptor(0)?metadata('stat','descriptor'):unknown('fstat descriptor mismatch');
    case 'getdents':case 'getdents64':return row.operation==='directory'&&descriptor(0)?{kind:'enumeration',following:'descriptor'}:unknown('directory descriptor mismatch');
    case 'chdir':return row.operation==='context'&&path(0)&&!empty()?metadata('chdir','follow'):unknown('chdir pathname mismatch');
    case 'fchdir':return row.operation==='context'&&descriptor(0)?metadata('chdir','descriptor'):unknown('fchdir descriptor mismatch');
    case 'execve':return row.operation==='execute'&&path(0)&&!empty()?{kind:'execute',following:'follow'}:unknown('exec pathname mismatch');
    case 'execveat':{
      const value=inputAtFlags(row);
      if(row.operation!=='execute'||!path(1,0)||value===undefined)return unknown('unknown execveat subject or flags');
      if(subject.kind==='descriptor'&&(!subject.pathArgument||subject.pathArgument.value.null)||empty()&&(value&0x1000n)===0n)return unknown('invalid null or empty execveat pathname');
      return {kind:'execute',following:following(value)};
    }
    case 'symlink':case 'symlinkat':
      if(row.operation!=='symlink')return unknown('symlink operation mismatch');
      if(path(0)&&subject.kind==='path')return {kind:'literal',text:subject.name};
      return path(row.syscall==='symlink'?1:2,row.syscall==='symlink'?-1:1)&&!empty()?mutation('link-destination','no-follow'):unknown('symlink destination mismatch');
    case 'link':case 'linkat':{
      if(row.operation!=='link')return unknown('hard-link operation mismatch');
      const at=row.syscall==='linkat',value=at?inputAtFlags(row):0n;
      if(value===undefined)return unknown('unknown linkat flags');
      if(path(at?1:0,at?0:-1)){
        if(empty()&&(value&0x1000n)===0n)return unknown('empty link source without AT_EMPTY_PATH');
        return {kind:'hard-link-source',following:empty()?'descriptor':(value&0x400n)!==0n?'follow':'no-follow'};
      }
      return path(at?3:1,at?2:-1)&&!empty()?mutation('link-destination','no-follow'):unknown('hard-link destination mismatch');
    }
    case 'rename':case 'renameat':case 'renameat2':{
      if(row.operation!=='mutation')return unknown('rename operation mismatch');
      if(row.syscall==='renameat2'&&flags(4,7n)===undefined)return unknown('unknown renameat2 flags');
      const at=row.syscall!=='rename';
      if(empty())return unknown('empty rename pathname');
      if(path(at?1:0,at?0:-1))return mutation('rename-source','no-follow');
      return path(at?3:1,at?2:-1)?mutation('rename-destination','no-follow'):unknown('rename subject position mismatch');
    }
    case 'unlinkat':
      if(row.operation!=='mutation'||!path(1,0)||empty()||flags(2,0x200n)===undefined)return unknown('unknown unlinkat subject or flags');
      return mutation('remove','no-follow');
    case 'unlink':case 'rmdir':case 'mkdir':case 'truncate':case 'mkdirat':{
      const at=row.syscall==='mkdirat';
      if(row.operation!=='mutation'||!path(at?1:0,at?0:-1)||empty())return unknown('mutation subject mismatch');
      return mutation(row.syscall==='mkdir'||at?'mkdir':row.syscall==='truncate'?'truncate':'remove',row.syscall==='truncate'?'follow':'no-follow');
    }
    default:return unknown('unsupported filesystem request '+row.syscall);
  }
}
