// Parser-free producer generation observations. Git sees only literal module
// candidates before installation and exact executable members afterwards.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
import {toolingModuleName} from '../gate/tooling-module-name.ts';
const failure=(message:string)=>new ToolingInstrumentError('tooling-setup','dependency inputs: '+message);
function gitBytes(repo:string,...args:string[]):string{
  return execFileSync('git',gitArguments(args),{cwd:repo,encoding:'utf8',maxBuffer:Infinity,stdio:['ignore','pipe','pipe']});
}
/** An index-only query needs neither the parser nor worktree-wide stats. */
export function dependencySourceCandidates(repo:string):string[]{
  return gitBytes(repo,'ls-files','-z','--cached').split('\0').filter(toolingModuleName);
}
export type SourceState={paths:ReadonlySet<string>;index:Map<string,string>;status:Map<string,string>;dirty:Map<string,string>};
function workingBlob(repo:string,path:string,blob:string):string{
  const file=join(repo,path);
  let kind:ReturnType<typeof lstatSync>;
  try{kind=lstatSync(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return 'absent';throw error;}
  // Unrelated changed directories and links need no byte traversal. They can
  // never qualify as executable recipe files below.
  if(!kind.isFile()||kind.isSymbolicLink())return 'non-file';
  const bytes=readFileSync(file);
  return createHash(blob.length===40?'sha1':'sha256').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
/** The index supplies clean content identities, including before the first
 * commit. Dirty working files need their own hashes: an M flag alone cannot
 * distinguish two edits to an already-dirty producer. Membership is selected
 * after installation, so the pre-install set covers the tooling owner's module
 * candidates. Every eventual member must have been selected in that set. */
export function sourceState(repo:string,paths:readonly string[]):SourceState{
  if(!paths.length)throw failure('source snapshot has no module candidates');
  const selected=new Set(paths);
  for(const path of selected)if(!path||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..')||/[\\\x00-\x1f]/.test(path))throw failure('invalid source member: '+path);
  const pathspecs=[...selected].map(path=>':(literal)'+path);
  const index=new Map<string,string>(),status=new Map<string,string>(),dirty=new Map<string,string>();
  for(const row of gitBytes(repo,'ls-files','--stage','-z','--cached','--',...pathspecs).split('\0').filter(Boolean)){
    const tab=row.indexOf('\t'),entry=row.slice(0,tab),path=row.slice(tab+1);
    if(tab<0||!/^\d{6} (?:[a-f0-9]{40}|[a-f0-9]{64}) [0-3]$/.test(entry)||!path)throw failure('invalid recipe index entry');
    index.set(path,index.has(path)?index.get(path)+'\0'+entry:entry);
  }
  // Every producer member must be indexed. Untracked discovery cannot certify
  // code, and would make unrelated ignore files and directories inputs again.
  const rows=gitBytes(repo,'status','--porcelain=v2','-z','--untracked-files=no','--',...pathspecs).split('\0').filter(Boolean);
  for(let i=0;i<rows.length;i++){
    const row=rows[i]!,kind=row[0],offset=kind==='1'?8:kind==='2'?9:kind==='u'?10:kind==='?'||kind==='!'?1:0;
    if(!offset)throw failure('unsupported recipe status entry');
    const path=row.split(' ').slice(offset).join(' ');
    if(!path)throw failure('recipe status entry has no path');
    let value=row;
    if(kind==='2'){
      const original=rows[++i];if(!original)throw failure('recipe rename has no original path');
      value+='\0'+original;status.set(original,value);
    }
    status.set(path,value);
    const entry=index.get(path);
    if(entry&&!entry.includes('\0'))dirty.set(path,workingBlob(repo,path,entry.split(' ')[1]!));
  }
  return {paths:selected,index,status,dirty};
}
export function assertSourceState(repo:string,before:SourceState,members:readonly string[],owner:'producer'|'target'){
  for(const path of members)if(!before.paths.has(path))throw failure('catalog '+owner+' recipe was not captured before installation: '+path+'; untracked members must be added to the index (git add <path>) before installing, and executable code must belong to the tooling module inventory');
  const after=sourceState(repo,members);
  for(const path of members){
    const first=before.index.get(path),last=after.index.get(path),file=join(repo,path);
    let kind:ReturnType<typeof lstatSync>|undefined;
    try{kind=lstatSync(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(owner==='target'&&!first&&!last&&!kind)continue;
    if(!first||!last)throw failure('catalog '+owner+' recipe is untracked or ignored: '+path);
    if(first.includes('\0')||!/^100(?:644|755) (?:[a-f0-9]{40}|[a-f0-9]{64}) 0$/.test(first))throw failure('catalog '+owner+' recipe is not tracked regular code: '+path);
    const expected=before.dirty.get(path)??first.split(' ')[1]!;
    if(first!==last||before.status.get(path)!==after.status.get(path)||workingBlob(repo,path,first.split(' ')[1]!)!==expected)
      throw failure('catalog '+owner+' source changed during installation: '+path);
    if(kind&&(!kind.isFile()||kind.isSymbolicLink()))throw failure('catalog '+owner+' recipe is not regular code: '+path);
  }
}
