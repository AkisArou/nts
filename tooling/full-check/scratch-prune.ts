// Prune a closed issue's kept scratch (~/.cache/nts-scratch/<N>/) to what its
// committed records cite (docs/workflow.md, The machine: "Pruning closed
// issues' scratch"). Run by hand, on issues named on the command line:
//
//   node tooling/full-check/scratch-prune.ts plan --out <dir> <N...>   the dry run: <dir>/plan.json, report.md, lists
//   node tooling/full-check/scratch-prune.ts apply <dir>               remove exactly what that dry run listed
//   node tooling/full-check/scratch-prune.ts verify <N...>             every committed citation still resolves
//
// What is kept, per folder (keep.ts reads the citations):
//   - each entry a citing record names, absolutely (any home or cache
//     spelling) or relative to the folder root or to a directory that record
//     cites in it; a cited directory keeps its whole subtree; the folder root
//     itself is an anchor that keeps nothing by itself;
//   - one hop of binding: a file cited directly that names another file of
//     the folder and carries that file's SHA-256 keeps it;
//   - a kept symbolic link's target, when the link stays inside the folder.
//     A link is never followed out of the folder: it is kept or removed as a
//     link, and its target is never read.
// What refuses a folder, by name, with nothing removed in it: an issue that
// is not closed or whose state is unknown, a cited or bound file whose
// SHA-256 disagrees with the record, a hashed citation through a link out of
// the folder, an absolute citation that names nothing, an entry on another
// device, and, at apply, any change to the issue, the plan or the inventory
// since the dry run.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync,closeSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,readdirSync,readlinkSync,rmdirSync,unlinkSync,writeFileSync,type BigIntStats} from 'node:fs';
import {homedir} from 'node:os';
import {join,posix,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acceptedRevision} from '../gate/accepted-revision-data.ts';
import {citationTokens,readCitingRecords,type CitingRecord,type CitationToken,type DigestMark} from './keep.ts';

export type IssueState='OPEN'|'CLOSED'|{error:string};
export type EntryType='file'|'directory'|'link'|'other';
/** One inventory entry, as lstat sees it; `link` is a link's text, never followed. */
export type Entry={path:string;type:EntryType;dev:string;ino:string;size:number;blocks:number;mode:number;mtimeNs:string;ctimeNs:string;link?:string};
export type KeptWhy='file'|'directory'|'binding'|'link';
export type Verification='verified'|'sha-less'|'escaping-link';
export type KeptCitation={path:string;why:KeptWhy;verification?:Verification;sha?:string;by:string[];
  /** A kept directory: its entries, disk bytes, and the digest of its listing with each file's SHA-256. */
  tree?:{entries:number;bytes:number;digest:string}};
export type FolderPlan={
  folder:string;issue:number;state:string;records:string[];refusals:string[];
  inventoryDigest:string;entries:number;bytes:number;
  kept:KeptCitation[];
  totals:Record<KeptWhy,{entries:number;bytes:number}>;
  keptEntries:number;keptBytes:number;
  remove:{entries:number;bytes:number;digest:string};
};
/** A digest is reused only for an entry whose lstat identity is unchanged. */
export type DigestMemo=Map<string,string>;

const identity=(entry:Entry)=>`${entry.path}\0${entry.dev}\0${entry.ino}\0${entry.size}\0${entry.mtimeNs}\0${entry.ctimeNs}`;
const sha256=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const typeOf=(st:BigIntStats):EntryType=>st.isSymbolicLink()?'link':st.isDirectory()?'directory':st.isFile()?'file':'other';
const ancestors=(path:string)=>{const out:string[]=[];let p=path;while(p.includes('/')){p=p.slice(0,p.lastIndexOf('/'));out.push(p);}return out;};

/** Every entry under `root`, by lstat only. An entry on another device is a refusal. */
export function inventory(root:string):{entries:Map<string,Entry>;refusals:string[]}{
  const entries=new Map<string,Entry>(),refusals:string[]=[];
  const top=lstatSync(root,{bigint:true});
  if(!top.isDirectory())return {entries,refusals:[`${root} is not a directory`]};
  const visit=(rel:string)=>{
    for(const name of readdirSync(join(root,rel)).sort()){
      const path=rel?rel+'/'+name:name,st=lstatSync(join(root,path),{bigint:true}),type=typeOf(st);
      if(st.dev!==top.dev){refusals.push(`${path} is on another device`);continue;}
      entries.set(path,{path,type,dev:String(st.dev),ino:String(st.ino),size:Number(st.size),blocks:Number(st.blocks)*512,mode:Number(st.mode),
        mtimeNs:String(st.mtimeNs),ctimeNs:String(st.ctimeNs),...(type==='link'?{link:readlinkSync(join(root,path))}:{})});
      if(type==='directory')visit(path);
    }
  };
  visit('');
  return {entries,refusals};
}

/** The canonical inventory digest: any added, removed or changed entry moves it. */
export function inventoryDigest(entries:Map<string,Entry>):string{
  return sha256([...entries.values()].map(entry=>JSON.stringify(entry)).join('\n'));
}

function digestOf(root:string,entry:Entry,memo:DigestMemo):string{
  const key=identity(entry),known=memo.get(key);
  if(known)return known;
  const hash=createHash('sha256'),fd=openSync(join(root,entry.path),'r'),buffer=Buffer.allocUnsafe(1<<22);
  try{for(let n;(n=readSync(fd,buffer,0,buffer.length,null))>0;)hash.update(buffer.subarray(0,n));}finally{closeSync(fd);}
  const value=hash.digest('hex');memo.set(key,value);return value;
}

/** A link's target inside the folder, lexically, or null when it leaves it. */
function linkTarget(root:string,entry:Entry):string|null{
  const text=entry.link!;
  const target=text.startsWith('/')?relative(root,posix.normalize(text)):posix.normalize(posix.join(posix.dirname(entry.path),text));
  return target===''||target==='.'||target.startsWith('../')||target==='..'||target.startsWith('/')?null:target;
}

type Resolution={final:string;via:string[];escaped:boolean};
const globPart=(part:string)=>/[*?]/.test(part)?new RegExp('^'+part.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'[^/]*').replace(/\?/g,'[^/]')+'$'):null;

/** Resolve a path relative to the folder root through the inventory, never
 * leaving the folder: a link inside it is followed lexically, a link out of
 * it ends the resolution at the link. Globs match within one component. */
function resolvePath(root:string,entries:Map<string,Entry>,path:string,globs=false):Resolution[]{
  const parts=path.split('/').filter(part=>part!==''&&part!=='.');
  if(parts.some(part=>part==='..')||parts.length===0)return [];
  const out:Resolution[]=[];
  const walk=(at:string,rest:string[],via:string[],hops:number)=>{
    if(hops>40)return;
    if(rest.length===0){
      const entry=entries.get(at);
      if(entry?.type==='link'){
        const target=linkTarget(root,entry);
        if(target===null){out.push({final:at,via,escaped:true});return;}
        walk('',target.split('/'),[...via,at],hops+1);return;
      }
      if(entry)out.push({final:at,via,escaped:false});
      return;
    }
    const [part,...tail]=rest,glob=globs?globPart(part!):null;
    const names=glob?[...entries.values()].filter(e=>posix.dirname(e.path)===(at||'.')&&glob.test(posix.basename(e.path))).map(e=>e.path):[at?at+'/'+part:part!];
    for(const next of names){
      const entry=entries.get(next);
      if(!entry)continue;
      if(entry.type==='link'&&tail.length>0){
        const target=linkTarget(root,entry);
        if(target===null){out.push({final:next,via,escaped:true});continue;}
        walk('',[...target.split('/'),...tail],[...via,next],hops+1);continue;
      }
      if(tail.length>0&&entry.type!=='directory')continue;
      walk(next,tail,via,hops);
    }
  };
  walk('',parts,[],0);
  return out;
}

/** Brace alternatives, as a shell expands them; an unbalanced brace is literal. */
export function expandBraces(text:string):string[]{
  const m=/\{([^{}]*,[^{}]*)\}/.exec(text);
  if(!m)return [text];
  return m[1]!.split(',').flatMap(choice=>expandBraces(text.slice(0,m.index)+choice+text.slice(m.index+m[0].length)));
}

type Hit={token:CitationToken;record:string;resolutions:Resolution[]};
/** Resolve one record's tokens against the folder. An absolute token resolves
 * from the root; the others from the root and from each directory the record
 * cites absolutely (and `extraBases`). The longest variant that names an
 * entry wins; an absolute citation naming nothing is returned unresolved. */
function resolveRecord(root:string,entries:Map<string,Entry>,record:CitingRecord,folder:string,extraBases:string[]=[]):{hits:Hit[];unresolved:string[];digests:DigestMark[];json:boolean}{
  const {tokens,digests,json}=citationTokens(record.text,folder),hits:Hit[]=[],unresolved:string[]=[];
  const attempt=(token:CitationToken,bases:string[])=>{
    for(const variant of token.variants){
      if(token.form!=='absolute'&&(/\s|:\/\//.test(variant)||/^[/~$-]/.test(variant)||variant.length>4096))continue;
      const expansions=expandBraces(variant.replace(/^\.\//,''));
      const found=expansions.flatMap(path=>bases.flatMap(base=>resolvePath(root,entries,base?base+'/'+path:path,token.form==='absolute')));
      if(found.length)return found;
    }
    return [];
  };
  const absolute=tokens.filter(token=>token.form==='absolute');
  const bases=new Set<string>(['',...extraBases]);
  for(const token of absolute){
    const resolutions=attempt(token,['']);
    // The folder root itself is an anchor, never an unresolved citation.
    if(!resolutions.length&&token.variants.some(variant=>/^[./]*$/.test(variant)))continue;
    if(!resolutions.length){unresolved.push(`${record.path}:${token.line+1}: ${folder}/${token.variants[0]}`);continue;}
    hits.push({token,record:record.path,resolutions});
    for(const r of resolutions)if(!r.escaped&&entries.get(r.final)?.type==='directory')bases.add(r.final);
  }
  for(const token of tokens)if(token.form!=='absolute'){
    const resolutions=attempt(token,[...bases]);
    if(resolutions.length)hits.push({token,record:record.path,resolutions});
  }
  return {hits,unresolved,digests,json};
}

/** The digest beside a citation. In JSON, by structure: a path key's own
 * value, a sibling `<key>Sha256` (or `_sha256`, `Sha`, `Digest`, `Hash`), or a
 * lone `sha256` sibling when the object holds one cited path. Elsewhere, the
 * first digest after it in its paragraph (in its row, for a table) and
 * before the next resolved quoted or absolute citation. */
function adjacentDigests(hits:Hit[],digests:DigestMark[],json:boolean):Map<Hit,string>{
  const paired=new Map<Hit,string>(),cited=hits.filter(hit=>hit.token.form!=='word');
  if(json){
    const perObject=new Map<number,number>();
    for(const hit of cited){const slot=hit.token.slot;if(slot&&!slot.isKey)perObject.set(slot.object,(perObject.get(slot.object)??0)+1);}
    for(const hit of cited){
      const slot=hit.token.slot;if(!slot)continue;
      const mark=slot.isKey?digests.find(d=>d.slot?.object===slot.object&&!d.slot.isKey&&d.slot.key===slot.key)
        :digests.find(d=>{
          if(d.slot?.object!==slot.object||d.slot.isKey||d.slot.key===null)return false;
          const key=d.slot.key.toLowerCase(),own=(slot.key??'').toLowerCase();
          if(own&&/^[-_]?(sha-?256|sha|digest|hash)$/.test(key.startsWith(own)?key.slice(own.length):'-'))return true;
          return /^(sha-?256|sha|digest|hash)$/.test(key)&&perObject.get(slot.object)===1;
        });
      if(mark)paired.set(hit,mark.value);
    }
    return paired;
  }
  const sorted=[...cited].sort((a,b)=>a.token.start-b.token.start);
  sorted.forEach((hit,i)=>{
    let next=Infinity;for(const later of sorted.slice(i+1))if(later.token.start>=hit.token.end){next=later.token.start;break;}
    const mark=digests.find(d=>d.start>=hit.token.end&&d.start<next&&d.paragraph===hit.token.paragraph&&(!hit.token.tableRow||d.line===hit.token.line));
    if(mark)paired.set(hit,mark.value);
  });
  return paired;
}

const MANIFEST_LIMIT=256<<20;
function readText(root:string,entry:Entry):string|null{
  if(entry.type!=='file'||entry.size>MANIFEST_LIMIT)return null;
  const data=readFileSync(join(root,entry.path));
  return data.subarray(0,1<<16).includes(0)?null:data.toString('utf8');
}

export type PlanInput={cache:string;issue:number;state:IssueState;records:CitingRecord[]|{error:string};memo?:DigestMemo};
export type PlanResult={plan:FolderPlan;remove:Entry[];kept:{entry:Entry;sha?:string}[];memo:DigestMemo};

/** The dry run for one folder: what its records keep and what would go. */
export function planFolder(input:PlanInput):PlanResult{
  const folder=`nts-scratch/${input.issue}`,root=join(input.cache,folder),memo=input.memo??new Map<string,string>();
  const refusals:string[]=[];
  const state=typeof input.state==='string'?input.state:'unknown';
  if(input.state!=='CLOSED')refusals.push(`issue #${input.issue} is ${typeof input.state==='string'?input.state.toLowerCase():'in an unknown state ('+input.state.error+')'}`);
  const records='error' in input.records?[]:input.records;
  if('error' in input.records)refusals.push(`committed records unreadable: ${input.records.error}`);
  else if(records.length===0)refusals.push(`no committed record cites ${folder}`);
  const {entries,refusals:walked}=inventory(root);refusals.push(...walked);
  const kept=new Map<string,KeptCitation>();
  const keep=(path:string,why:KeptWhy,by:string,extra:Partial<KeptCitation>={})=>{
    const known=kept.get(path);
    const rank:Record<KeptWhy,number>={directory:0,file:1,binding:2,link:3};
    if(!known){kept.set(path,{path,why,by:[by],...extra});return;}
    if(!known.by.includes(by))known.by.push(by);
    if(rank[why]<rank[known.why])known.why=why;
    if(extra.verification&&(!known.verification||known.verification==='sha-less'))Object.assign(known,extra);
  };
  const allDigests=new Set<string>();
  const hits:Hit[]=[],paired=new Map<Hit,string>();
  for(const record of records){
    const resolved=resolveRecord(root,entries,record,folder);
    hits.push(...resolved.hits);
    for(const [hit,value] of adjacentDigests(resolved.hits,resolved.digests,resolved.json))paired.set(hit,value);
    for(const d of resolved.digests)allDigests.add(d.value);
    for(const line of resolved.unresolved)refusals.push(`absolute citation names nothing: ${line}`);
  }
  const direct:string[]=[];
  for(const hit of hits){
    const by=`${hit.record}:${hit.token.line+1}`,hash=paired.get(hit);
    for(const r of hit.resolutions){
      for(const link of r.via)keep(link,'link',by);
      const entry=entries.get(r.final)!;
      if(r.escaped){
        keep(r.final,'file',by,{verification:'escaping-link'});
        if(hash&&hit.token.form!=='word')refusals.push(`${by}: ${r.final} is a link out of the folder; its SHA-256 ${hash} cannot be verified`);
        continue;
      }
      if(entry.type==='directory'){keep(r.final,'directory',by);continue;}
      if(entry.type!=='file'){keep(r.final,'file',by);continue;}
      const sha=digestOf(root,entry,memo);
      if(allDigests.has(sha))keep(r.final,'file',by,{verification:'verified',sha});
      else if(hash&&hit.token.form!=='word'){keep(r.final,'file',by,{sha});refusals.push(`${by}: ${r.final} has SHA-256 ${sha}; the record gives ${hash}`);}
      else keep(r.final,'file',by,{verification:'sha-less',sha});
      if(!direct.includes(r.final))direct.push(r.final);
    }
  }
  // One hop: a directly cited file that names another file of the folder
  // with that file's digest binds it. Bound files are not read in turn.
  for(const path of direct){
    const entry=entries.get(path)!,text=readText(root,entry);
    if(text===null)continue;
    const bindingRecord={path,text},resolved=resolveRecord(root,entries,bindingRecord,folder,[posix.dirname(path)==='.'?'':posix.dirname(path)]);
    const own=new Set(resolved.digests.map(d=>d.value)),pairs=adjacentDigests(resolved.hits,resolved.digests,resolved.json);
    for(const hit of resolved.hits){
      if(hit.token.form==='word')continue;
      const hash=pairs.get(hit);
      for(const r of hit.resolutions){
        const bound=entries.get(r.final)!;
        if(r.escaped||bound.type!=='file'||r.final===path)continue;
        const sha=digestOf(root,bound,memo);
        if(own.has(sha)){for(const link of r.via)keep(link,'link',`${path} (binding)`);keep(r.final,'binding',path,{verification:'verified',sha});}
        else if(hash)refusals.push(`${path} binds ${r.final} with SHA-256 ${hash}; the file has ${sha}`);
      }
    }
  }
  // A kept link that stays inside the folder keeps its target, wherever the
  // link itself was kept from (a cited directory's links included).
  const keptUnder=(path:string)=>{for(const p of [path,...ancestors(path)]){const k=kept.get(p);if(k&&(p===path||k.why==='directory'))return true;}return false;};
  for(let changed=true;changed;){
    changed=false;
    for(const entry of entries.values()){
      if(entry.type!=='link'||!keptUnder(entry.path))continue;
      const target=linkTarget(root,entry);
      if(target===null)continue;
      for(const r of resolvePath(root,entries,target)){
        if(!keptUnder(r.final)){keep(r.final,entries.get(r.final)?.type==='directory'?'directory':'link',`link ${entry.path}`);changed=true;}
        for(const via of r.via)if(!kept.has(via)){keep(via,'link',`link ${entry.path}`);changed=true;}
      }
    }
  }
  // Classify the inventory: kept when cited, under a cited directory, or an
  // ancestor of something kept; everything else is removed.
  const keptRoots=[...kept.values()];
  const keptAncestors=new Set(keptRoots.flatMap(k=>ancestors(k.path)));
  const why=(entry:Entry):KeptWhy|null=>{
    const exact=kept.get(entry.path);
    if(exact)return exact.why;
    for(const a of ancestors(entry.path)){const k=kept.get(a);if(k?.why==='directory')return 'directory';}
    return null;
  };
  const totals:FolderPlan['totals']={file:{entries:0,bytes:0},directory:{entries:0,bytes:0},binding:{entries:0,bytes:0},link:{entries:0,bytes:0}};
  const remove:Entry[]=[],keptEntries:{entry:Entry;sha?:string}[]=[];
  const keptInodes=new Set<string>();
  let bytes=0,keptBytes=0;
  for(const entry of entries.values()){
    bytes+=entry.blocks;
    const w=why(entry);
    if(w||keptAncestors.has(entry.path)){
      keptInodes.add(entry.ino);keptBytes+=entry.blocks;
      if(w){totals[w].entries++;totals[w].bytes+=entry.blocks;}
      keptEntries.push({entry,...(entry.type==='file'&&w?{sha:digestOf(root,entry,memo)}:{})});
    }else remove.push(entry);
  }
  for(const k of keptRoots)if(entries.get(k.path)?.type==='directory'){
    const inside=keptEntries.filter(({entry})=>entry.path.startsWith(k.path+'/'));
    k.tree={entries:inside.length,bytes:inside.reduce((n,{entry})=>n+entry.blocks,0),
      digest:sha256(inside.map(({entry,sha})=>`${entry.type}\t${entry.path.slice(k.path.length+1)}\t${sha??entry.link??''}`).join('\n'))};
  }
  const freed=new Set<string>();let removeBytes=0;
  for(const entry of remove)if(!keptInodes.has(entry.ino)&&!freed.has(entry.ino)){freed.add(entry.ino);removeBytes+=entry.blocks;}
  remove.sort((a,b)=>b.path.split('/').length-a.path.split('/').length||(a.path<b.path?-1:a.path>b.path?1:0));
  const plan:FolderPlan={folder,issue:input.issue,state,records:records.map(r=>r.path),refusals:[...new Set(refusals)],
    inventoryDigest:inventoryDigest(entries),entries:entries.size,bytes,
    kept:keptRoots.sort((a,b)=>a.path<b.path?-1:1),totals,keptEntries:keptEntries.length,keptBytes,
    remove:{entries:remove.length,bytes:removeBytes,digest:removalDigest(remove)}};
  return {plan,remove,kept:keptEntries,memo};
}

export function removalDigest(remove:Entry[]):string{return sha256(remove.map(entry=>JSON.stringify([entry.path,entry.type,entry.ino,entry.ctimeNs])).join('\n'));}

/** Remove exactly `remove`, deepest first, each only while its lstat
 * identity is the one the dry run listed. Read-only parents gain u+wx for the
 * removal; a kept directory's mode is restored after. */
export function removeListed(root:string,remove:Entry[]):{removed:number;error?:string}{
  const removing=new Set(remove.map(entry=>entry.path)),changed=new Map<string,number>();
  const parents=new Set(remove.map(entry=>posix.dirname(entry.path)));
  try{
    for(const parent of parents){
      const path=parent==='.'?root:join(root,parent),st=lstatSync(path,{bigint:true});
      if(!st.isDirectory())return {removed:0,error:`${parent} is no longer a directory`};
      const mode=Number(st.mode)&0o7777;
      if((mode&0o300)===0o300)continue;
      chmodSync(path,mode|0o700);
      if(!removing.has(parent))changed.set(path,mode);
    }
  }catch(error){return {removed:0,error:error instanceof Error?error.message:String(error)};}
  let removed=0;
  try{
    for(const entry of remove){
      const path=join(root,entry.path),st=lstatSync(path,{bigint:true});
      // A directory's own ctime moves as its listed children go; a new child
      // makes its rmdir fail instead.
      if(typeOf(st)!==entry.type||String(st.ino)!==entry.ino||entry.type!=='directory'&&String(st.ctimeNs)!==entry.ctimeNs)
        return {removed,error:`${entry.path} changed since the dry run`};
      if(entry.type==='directory')rmdirSync(path);else unlinkSync(path);
      removed++;
    }
    return {removed};
  }catch(error){return {removed,error:error instanceof Error?error.message:String(error)};}
  finally{for(const [path,mode] of changed)try{chmodSync(path,mode);}catch{/* reported by verify */}}
}

export type ApplyResult={folder:string;status:'removed'|'refused'|'partial';lines:string[]};
/** Apply one folder's dry run: the issue, the plan and the inventory must be
 * the dry run's, or nothing is removed. Then verify. */
export function applyFolder(dryRun:FolderPlan,input:PlanInput):ApplyResult{
  const lines:string[]=[],folder=dryRun.folder;
  if(dryRun.refusals.length)return {folder,status:'refused',lines:['the dry run refused this folder: '+dryRun.refusals.join('; ')]};
  const now=planFolder(input);
  if(now.plan.refusals.length)return {folder,status:'refused',lines:now.plan.refusals};
  if(now.plan.inventoryDigest!==dryRun.inventoryDigest)lines.push('the folder changed since the dry run (inventory digest)');
  if(now.plan.remove.digest!==dryRun.remove.digest)lines.push('what would be removed changed since the dry run');
  if(JSON.stringify(now.plan.kept)!==JSON.stringify(dryRun.kept))lines.push('what the records keep changed since the dry run');
  if(lines.length)return {folder,status:'refused',lines};
  const result=removeListed(join(input.cache,folder),now.remove);
  lines.push(`removed ${result.removed} of ${now.remove.length} entries`);
  if(result.error){lines.push('stopped: '+result.error);return {folder,status:'partial',lines};}
  const after=verifyFolder({...input,memo:undefined});
  lines.push(...after.lines);
  return {folder,status:after.ok?'removed':'partial',lines};
}

/** Every committed citation into the folder resolves, with its SHA-256 where
 * the record gives one, and nothing left would be removed. */
export function verifyFolder(input:PlanInput):{ok:boolean;lines:string[]}{
  const {plan}=planFolder(input),lines:string[]=[];
  for(const refusal of plan.refusals)if(!/^issue #/.test(refusal))lines.push('refused: '+refusal);
  if(plan.remove.entries)lines.push(`${plan.remove.entries} entries are no longer cited`);
  const verified=plan.kept.filter(k=>k.verification==='verified').length;
  lines.push(`verify ${plan.folder}: ${plan.kept.length} citations resolve, ${verified} verified by SHA-256, ${plan.keptEntries} entries kept`);
  return {ok:lines.length===1,lines};
}

// ---------------------------------------------------------------------------
// The dry run's files and report.
// ---------------------------------------------------------------------------
const GB=(n:number)=>(n/1e9).toFixed(2)+' GB';
export function reportFolder(plan:FolderPlan,manifest:string):string{
  const out=[`### ${plan.folder} (#${plan.issue}, ${plan.state})`,''];
  if(plan.refusals.length){out.push('**Refused; nothing is removed:**','',...plan.refusals.map(r=>'- '+r),'');}
  const cell=(k:KeptCitation)=>`${k.by.slice(0,2).join(', ')}${k.by.length>2?` +${k.by.length-2}`:''}`;
  const direct=plan.kept.filter(k=>k.why!=='binding'),bound=plan.kept.filter(k=>k.why==='binding');
  const byManifest=new Map<string,{files:number;bytes:number}>();
  for(const k of bound)for(const by of k.by){const m=byManifest.get(by)??{files:0,bytes:0};m.files++;byManifest.set(by,m);}
  out.push(`Records: ${plan.records.map(r=>'`'+r+'`').join(', ')}`,'',
    `| | entries | disk |`,`|---|---:|---:|`,
    `| folder | ${plan.entries} | ${GB(plan.bytes)} |`,
    ...(['file','directory','binding','link'] as const).map(w=>`| kept by ${w==='binding'?'one-hop binding':w==='link'?'link or link target':w+' citation'} | ${plan.totals[w].entries} | ${GB(plan.totals[w].bytes)} |`),
    `| kept in all, with their parent directories | ${plan.keptEntries} | ${GB(plan.keptBytes)} |`,
    `| **removed** (disk freed counts each inode once) | ${plan.remove.entries} | ${GB(plan.remove.bytes)} |`,'',
    '| kept | why | SHA-256, or directory listing digest | cited by |','|---|---|---|---|',
    ...direct.map(k=>`| \`${k.path}\` | ${k.why}${k.verification?', '+k.verification:''}${k.tree?`, ${k.tree.entries} entries, ${GB(k.tree.bytes)}`:''} | ${k.sha?'`'+k.sha+'`':k.tree?'`'+k.tree.digest+'`':''} | ${cell(k)} |`),'');
  if(bound.length)out.push('| binding manifest | files it binds, each verified by its SHA-256 |','|---|---:|',
    ...[...byManifest].map(([by,m])=>`| \`${by}\` | ${m.files} |`),'');
  out.push(`Every kept entry with its SHA-256: \`${manifest}\`; the removal list and plan beside it (removal digest \`${plan.remove.digest}\`, inventory digest \`${plan.inventoryDigest}\`).`,'');
  return out.join('\n');
}

function writeLines(path:string,lines:Iterable<string>){
  const chunks:string[]=[];for(const line of lines)chunks.push(line);
  writeFileSync(path,chunks.join('\n')+(chunks.length?'\n':''));
}

export function issueState(repo:string,issue:number):IssueState{
  const r=spawnSync('gh',['issue','view',String(issue),'--json','state','-q','.state'],{cwd:repo,encoding:'utf8',timeout:60_000});
  const state=r.stdout?.trim();
  if(r.error||r.status!==0)return {error:r.error?.message||r.stderr?.trim()||'gh exit '+r.status};
  return state==='OPEN'||state==='CLOSED'?state:{error:'gh answered '+JSON.stringify(state)};
}

function plannedInput(repo:string,cache:string,issue:number,memo?:DigestMemo):PlanInput{
  const reader=acceptedRevision(repo);
  const records='error' in reader?reader:readCitingRecords(reader,`nts-scratch/${issue}`,cache);
  return {cache,issue,state:issueState(repo,issue),records,...(memo?{memo}:{})};
}

const issues=(args:string[])=>args.map(arg=>{if(!/^[1-9][0-9]*$/.test(arg))throw Error(`not an issue number: ${arg}`);return Number(arg);});

function main(argv:string[]):number{
  const repo=process.cwd(),cache=join(homedir(),'.cache'),[command,...rest]=argv;
  if(command==='plan'){
    const at=rest.indexOf('--out');if(at<0||!rest[at+1])throw Error('plan needs --out <dir>');
    const out=resolve(rest[at+1]!),numbers=issues(rest.filter((_,i)=>i!==at&&i!==at+1));
    mkdirSync(out,{recursive:true});
    const plans:FolderPlan[]=[],report:string[]=[];
    for(const issue of numbers){
      const {plan,remove,kept}=planFolder(plannedInput(repo,cache,issue));
      writeLines(join(out,`${issue}.remove.jsonl`),remove.map(entry=>JSON.stringify([entry.path,entry.type,entry.ino,entry.ctimeNs,entry.blocks])));
      writeLines(join(out,`${issue}.kept.jsonl`),kept.map(({entry,sha})=>JSON.stringify({...entry,...(sha?{sha}:{})})));
      plans.push(plan);report.push(reportFolder(plan,join(out,`${issue}.kept.jsonl`)));
      console.log(`${plan.folder}: ${plan.refusals.length?'REFUSED':'planned'}; keep ${plan.keptEntries} (${GB(plan.keptBytes)}), remove ${plan.remove.entries} (${GB(plan.remove.bytes)})`);
    }
    const main=acceptedRevision(repo);
    writeFileSync(join(out,'plan.json'),JSON.stringify({main:'error' in main?null:main.revision,plans},null,1)+'\n');
    writeFileSync(join(out,'report.md'),report.join('\n'));
    return plans.some(plan=>plan.refusals.length)?1:0;
  }
  if(command==='apply'){
    const out=resolve(rest[0]??''),{plans}=JSON.parse(readFileSync(join(out,'plan.json'),'utf8')) as {plans:FolderPlan[]};
    let failed=false;const lines:string[]=[];
    for(const dryRun of plans){
      const memo:DigestMemo=new Map();
      for(const line of readFileSync(join(out,`${dryRun.issue}.kept.jsonl`),'utf8').split('\n').filter(Boolean)){
        const {sha,...entry}=JSON.parse(line) as Entry&{sha?:string};if(sha)memo.set(identity(entry),sha);
      }
      const result=applyFolder(dryRun,plannedInput(repo,cache,dryRun.issue,memo));
      failed||=result.status!=='removed';
      lines.push(`${result.folder}: ${result.status}`,...result.lines.map(line=>'  '+line));
      console.log(lines.slice(-1-result.lines.length).join('\n'));
    }
    writeFileSync(join(out,'apply.md'),lines.join('\n')+'\n');
    return failed?1:0;
  }
  if(command==='verify'){
    let failed=false;
    for(const issue of issues(rest)){const r=verifyFolder(plannedInput(repo,cache,issue));failed||=!r.ok;console.log(r.lines.join('\n'));}
    return failed?1:0;
  }
  throw Error('usage: scratch-prune.ts plan --out <dir> <N...> | apply <dir> | verify <N...>');
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{process.exitCode=main(process.argv.slice(2));}
  catch(error){console.error(`scratch-prune: ${error instanceof Error?error.message:String(error)}`);process.exitCode=2;}
}
