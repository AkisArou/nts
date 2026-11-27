// The kept-path declarations, shared by inventory and pressure reclamation.
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join,isAbsolute,posix,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {acceptedRevisionData,type AcceptedRevision} from '../gate/accepted-revision-data.ts';
export type FolderStat = (path:string)=>{isDirectory():boolean;isSymbolicLink():boolean;mtimeMs:number};
export type TargetLock={path:string;owner:string};
export type TargetDeclaration=string|{tree:string;lock:TargetLock};
export type Keep = (
  | { kind: "kept" | "pool" | "pins"; why: string; writer?: string }
  | { kind: "runs" | "logs"; who: string; why: string; writer?: string }
  | { kind: "scratch"; writer: string; days?: number }
  | { kind: "folders" | "issue-scratch"; why: string; folders: Record<string, Keep> }
) & { targets?: Record<string, TargetDeclaration>; targetScratch?: Record<string,string>; legacyTargetScratch?: string[]; gateRunRoot?:true };

export const KEEP_FILE = fileURLToPath(new URL("keep.json", import.meta.url));

export function readKeep(file = KEEP_FILE): Record<string, Keep> {
  const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, Keep>;
  const inside = (path: string) => path !== "" && !isAbsolute(path) && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
  const check = (name: string, keep: Keep, top = false) => {
    if(keep.gateRunRoot!==undefined&&(keep.gateRunRoot!==true||keep.kind!=='logs'))throw Error(`${file}: ${name} gateRunRoot requires a logs rule and true`);
    if(keep.targetScratch!==undefined||keep.legacyTargetScratch!==undefined){
      if(!top||keep.kind!=='pool')throw Error(`${file}: ${name} scratch declarations require a top-level pool`);
      for(const [child,writer] of Object.entries(keep.targetScratch??{}))if(!inside(child)||child.includes('/')||typeof writer!=='string'||!writer)throw Error(`${file}: invalid target scratch declaration ${child}`);
      if(keep.legacyTargetScratch!==undefined&&(!Array.isArray(keep.legacyTargetScratch)||keep.legacyTargetScratch.some(child=>typeof child!=='string'||!inside(child)||child.includes('/'))))throw Error(`${file}: invalid legacy scratch layout`);
    }
    if (keep.targets !== undefined) {
      if (!top) throw new Error(`${file}: ${name} declares targets; only a top-level rule does`);
      if (keep.kind === "pool") throw new Error(`${file}: ${name} is a pool, whose kind declares each slot's target`);
      if (typeof keep.targets !== "object" || keep.targets === null || Array.isArray(keep.targets)) throw new Error(`${file}: ${name}'s targets are not a map of target to tree`);
      for (const [target, declaration] of Object.entries(keep.targets)) {
        const tree=typeof declaration==='string'?declaration:declaration?.tree;
        if(typeof declaration!=='string'){
          const lock=declaration?.lock;
          if(!lock||!inside(lock.path)||lock.owner!=='tooling/conformance/pin-lock.ts')throw Error(`${file}: ${name}/${target} has an unknown target lock owner or path`);
        }
        if (!inside(target) || typeof tree !== "string" || !inside(tree)) throw new Error(`${file}: ${name} declares target ${target} of tree ${String(tree)}; both must be relative paths inside its folder`);
      }
    }
    if (!["kept", "pool", "pins", "runs", "logs", "scratch", "folders", "issue-scratch"].includes(keep.kind)) throw new Error(`${file}: ${name} has an unknown kind ${String(keep.kind)}`);
    if (keep.kind === "scratch" && !keep.writer) throw new Error(`${file}: the scratch root ${name} names no writer`);
    if (keep.kind !== "scratch" && !keep.why) throw new Error(`${file}: ${name} does not say why it is kept`);
    if (keep.kind === "folders" || keep.kind === "issue-scratch") for (const [child, inner] of Object.entries(keep.folders)) {
      if(keep.kind==='issue-scratch'&&/^[0-9]+$/.test(child))throw Error(`${file}: ${name}/${child} is kept by issue state or committed record citation, not a keep.json row`);
      check(`${name}/${child}`, inner);
    }
  };
  for (const [name, keep] of Object.entries(value)) check(name, keep, true);
  return value;
}

function targetSlots(dir:string,stat:FolderStat=lstatSync):{name:string;path:string}[]{
  let names:string[];
  try{names=readdirSync(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  return names.sort().flatMap(name=>{
    const path=join(dir,name);
    try{const info=stat(path);return info.isDirectory()||info.isSymbolicLink()?[{name,path}]:[];}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  });
}
/** A declared cargo target and the tree whose builds write it. */
export type DeclaredTarget = { target: string; tree: string; lock?:TargetLock };
/** Every cargo target keep.json declares under `cache`, pool slots' included, whether or not it exists. */
export function declaredTargets(cache: string, keep: Record<string, Keep>, stat?: FolderStat): DeclaredTarget[] {
  return Object.entries(keep).flatMap(([name, rule]) => rule.kind === "pool"
    ? targetSlots(join(cache, name), stat).filter(slot => /^\d+$/.test(slot.name)).map(slot => ({ target: join(slot.path, "target"), tree: slot.path }))
    : Object.entries(rule.targets ?? {}).map(([target, declaration]) => {
      const tree=typeof declaration==='string'?declaration:declaration.tree;
      return {target:join(cache,name,target),tree:join(cache,name,tree),...(typeof declaration==='string'?{}:{lock:{owner:declaration.lock.owner,path:join(cache,name,declaration.lock.path)}})};
    }));
}

/** Run log roots whose raw cost evidence has the same retention contract. */
export function declaredRunRoots(cache:string,keep:Record<string,Keep>):string[]{
  const roots:string[]=[];
  const visit=(path:string,rule:Keep)=>{
    if(rule.kind==='runs')roots.push(join(path,'runs'));
    else if(rule.kind==='logs'&&rule.gateRunRoot)roots.push(path);
    else if(rule.kind==='folders')for(const [name,child] of Object.entries(rule.folders))visit(join(path,name),child);
  };
  for(const [name,rule] of Object.entries(keep))visit(join(cache,name),rule);
  return roots;
}

/** Explicit writer-owned namespaces. Legacy names are a bounded migration,
 * removed once no pool tree carries the old layout and no legacy trash remains. */
export function targetScratch(keep:Record<string,Keep>=readKeep()):{names:Record<string,string>;legacy:readonly string[]}{
  const pools=Object.values(keep).filter(rule=>rule.kind==='pool');
  return {names:Object.assign({},...pools.map(rule=>rule.targetScratch??{})) as Record<string,string>,legacy:pools.flatMap(rule=>rule.legacyTargetScratch??[])};
}

// ---------------------------------------------------------------------------
// Committed record citations of issue scratch: the one reader both the count
// (which folders a record keeps) and the scratch pruner (which paths inside a
// folder a record keeps) use. Records are docs/records/ and results/ at
// accepted main; working edits and candidate branches never decide retention.
// ---------------------------------------------------------------------------
const RECORDS=acceptedRevisionData(new URL('../../docs/records/',import.meta.url));
const RESULTS=acceptedRevisionData(new URL('../../results/',import.meta.url));
const DOCS=acceptedRevisionData(new URL('../../docs/',import.meta.url));
const FOLDER_PATTERN='nts-scratch/[1-9][0-9]*|nts-[1-9][0-9]*-scratch';
const HOME_PREFIXES=['~/.cache/','$HOME/.cache/','${HOME}/.cache/'];
export type Unreadable={error:string};

/** Literal record citations have a path boundary, so issue 7610 cannot keep
 * 761. A relative path names an input inside the folder; absolute and home
 * spellings may also name the folder itself. */
export function scratchRecordCitations(text:string,cache:string):string[]{
  const found=new Set<string>(),prefixes=[resolve(cache)+'/',...HOME_PREFIXES];
  for(const match of text.matchAll(/nts-scratch\/[1-9][0-9]*|nts-[1-9][0-9]*-scratch/g)){
    const path=match[0],at=match.index,next=text[at+path.length];
    const folder=prefixes.some(prefix=>at>=prefix.length&&text.startsWith(prefix,at-prefix.length));
    if(next==='/'||folder&&(next===undefined||/[\s`"'<>),;:\]}.]/.test(next)))found.add(path);
  }
  return [...found].sort();
}

/** Every issue folder a committed record cites. Unknown Git state is an
 * error the caller keeps folders by. */
export function readScratchRecordCitations(reader:AcceptedRevision,cache:string):string[]|Unreadable{
  const records=reader.grep(RECORDS,FOLDER_PATTERN),results=reader.grep(RESULTS,FOLDER_PATTERN);
  if(typeof records!=='string')return records;
  if(typeof results!=='string')return results;
  return scratchRecordCitations(records+'\n'+results,cache);
}

/** A committed record, whole: a relative path cites only beside its own root.
 * `linkedFrom` names the citing record whose Markdown link brought it in. */
export type CitingRecord={path:string;text:string;linkedFrom?:string};

/** The committed files a Markdown record links relatively, inside docs/ or
 * results/: `[x](x.json)` against the record's own directory. */
export function linkedRecordPaths(record:CitingRecord):string[]{
  if(!record.path.endsWith('.md'))return [];
  const found=new Set<string>();
  for(const m of record.text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)){
    const target=m[1]!.replace(/[#?].*$/,'');
    if(!target||/^[a-z][a-z0-9+.-]*:/i.test(target)||target.startsWith('/'))continue;
    let decoded:string;try{decoded=decodeURIComponent(target);}catch{continue;}
    const path=posix.normalize(posix.join(posix.dirname(record.path),decoded));
    if(/^(docs|results)\/[^/]/.test(path)&&!path.split('/').includes('..'))found.add(path);
  }
  return [...found].sort();
}

/** The records that cite `folder` (nts-scratch/<N>), by the same boundary
 * rule, then one hop of the committed files they link: a record may give
 * its digests in a companion file that never names the folder. */
export function readCitingRecords(reader:AcceptedRevision,folder:string,cache:string):CitingRecord[]|Unreadable{
  const pattern=folder.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^0-9]|$)';
  const records=reader.files(RECORDS,pattern),results=reader.files(RESULTS,pattern);
  if('error' in records)return records;
  if('error' in results)return results;
  const citing=[...records,...results].filter(record=>scratchRecordCitations(record.text,cache).includes(folder));
  const seen=new Set(citing.map(record=>record.path)),linked:CitingRecord[]=[];
  for(const record of citing)for(const path of linkedRecordPaths(record)){
    if(seen.has(path))continue;
    seen.add(path);
    const text=path.startsWith('docs/')?reader.within(DOCS,path.slice('docs/'.length)):reader.within(RESULTS,path.slice('results/'.length));
    // A link to a missing file, a directory or a binary blob carries no citation.
    if(typeof text!=='string'||text.slice(0,1<<16).includes('\0'))continue;
    linked.push({path,text,linkedFrom:record.path});
  }
  return [...citing,...linked];
}

/** Every SHA-256 any committed file of docs/ or results/ gives, with where it
 * first stands: the dry run's safety net for removed files that a record
 * elsewhere may vouch for. */
export function readCommittedDigests(reader:AcceptedRevision):Map<string,string>|Unreadable{
  const out=new Map<string,string>();
  for(const found of [reader.matches(DOCS,'[0-9a-fA-F]{64,}'),reader.matches(RESULTS,'[0-9a-fA-F]{64,}')]){
    if('error' in found)return found;
    for(const {path,line,match} of found){
      // A longer hex run is not a SHA-256.
      if(match.length!==64)continue;
      const digest=match.toLowerCase();
      if(!out.has(digest))out.set(digest,`${path}:${line}`);
    }
  }
  return out;
}

/** One spelling in a record that may name an entry of the folder.
 * - absolute: the folder's own path (any home or cache spelling) and a path
 *   under it, relative to the folder root here; '' is the root itself;
 * - quoted: a backtick span, a double-quoted string or a table cell, tried
 *   relative to the root and to each directory the record cites absolutely;
 * - word: any other token of the text, tried the same way.
 * Variants are the spelling with trailing punctuation stripped one character
 * at a time; the resolver keeps the longest that names an entry. */
export type CitationToken={form:'absolute'|'quoted'|'word';variants:string[];start:number;end:number;line:number;paragraph:number;tableRow:boolean;slot?:JsonSlot};
/** Where a string stands in a JSON text: its object (or array), its key, and
 * whether it is that key itself. A JSON record pairs a path with a digest by
 * this structure, never by distance. */
export type JsonSlot={object:number;key:string|null;isKey:boolean};
/** A 64-hex digest in the record, where it stands. */
export type DigestMark={value:string;start:number;line:number;paragraph:number;slot?:JsonSlot};
export type CitationText={tokens:CitationToken[];digests:DigestMark[];json:boolean};

type JsonString={start:number;end:number;value:string;slot:JsonSlot};
/** The strings of a JSON text with their structure, or null when the text is
 * not JSON. Positions are of the string's content, inside its quotes. */
export function jsonStrings(text:string):JsonString[]|null{
  try{JSON.parse(text);}catch{return null;}
  const out:JsonString[]=[],stack:{id:number;object:boolean;key:string|null;expectKey:boolean}[]=[];
  let ids=0;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='{'||c==='['){stack.push({id:ids++,object:c==='{',key:null,expectKey:c==='{'});continue;}
    if(c==='}'||c===']'){stack.pop();continue;}
    const top=stack[stack.length-1];
    if(c===','&&top){if(top.object){top.expectKey=true;top.key=null;}continue;}
    if(c!=='"')continue;
    let j=i+1;while(text[j]!=='"')j+=text[j]==='\\'?2:1;
    const value=JSON.parse(text.slice(i,j+1)) as string;
    if(top){
      const isKey=top.object&&top.expectKey;
      out.push({start:i+1,end:j,value,slot:{object:top.id,key:isKey?value:top.key,isKey}});
      if(isKey){top.key=value;top.expectKey=false;}
    }
    i=j;
  }
  return out;
}

const TRAILING=/[.,;:)\]}>*!?'"]$/;
function variants(raw:string):string[]{
  const out=[raw];let s=raw;
  while(s.length>0&&TRAILING.test(s)){s=s.slice(0,-1);out.push(s);}
  return out;
}

/** The spellings of `text` that may cite inside `folder`, and its digests. */
export function citationTokens(text:string,folder:string):CitationText{
  const lineStarts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')lineStarts.push(i+1);
  const paragraphStarts=[0];for(const m of text.matchAll(/\n[ \t]*\n/g))paragraphStarts.push(m.index+m[0].length);
  const index=(starts:number[],at:number)=>{let lo=0,hi=starts.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(starts[mid]!<=at)lo=mid;else hi=mid-1;}return lo;};
  const lineText=(line:number)=>text.slice(lineStarts[line],line+1<lineStarts.length?lineStarts[line+1]!-1:text.length);
  const tokens:CitationToken[]=[];
  const add=(form:CitationToken['form'],raw:string,start:number,slot?:JsonSlot)=>{
    const line=index(lineStarts,start);
    tokens.push({form,variants:variants(raw),start,end:start+raw.length,line,paragraph:index(paragraphStarts,start),tableRow:/^\s*\|/.test(lineText(line)),...(slot?{slot}:{})});
  };
  const strings=jsonStrings(text);
  const slotAt=(at:number)=>{
    if(!strings)return undefined;
    let lo=0,hi=strings.length-1;
    while(lo<hi){const mid=(lo+hi+1)>>1;if(strings[mid]!.start<=at)lo=mid;else hi=mid-1;}
    const s=strings[lo];return s&&s.start<=at&&at<=s.end?s.slot:undefined;
  };
  const escaped=folder.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const m of text.matchAll(new RegExp(escaped+'(?![0-9])(/[^\\s`"\'<>|\\\\]*)?','g'))){
    const next=text[m.index+folder.length];
    if(next!==undefined&&next!=='/'&&!/[\s`"'<>),;:\]}.]/.test(next))continue;
    add('absolute',(m[1]??'').replace(/^\/+/,''),m.index);
  }
  if(strings)for(const token of tokens){const slot=slotAt(token.start);if(slot)token.slot=slot;}
  const quoted=(raw:string,start:number)=>{const t=raw.trim();if(t)add('quoted',t,start+raw.indexOf(t));};
  for(const m of text.matchAll(/`([^`\n]+)`/g))quoted(m[1]!,m.index+1);
  if(strings)for(const string of strings){const t=string.value.trim();if(t&&!/\n/.test(t))add('quoted',t,string.start,string.slot);}
  else for(const m of text.matchAll(/"([^"\\\n]+)"/g))quoted(m[1]!,m.index+1);
  for(let line=0;line<lineStarts.length;line++){
    const body=lineText(line);if(!/^\s*\|/.test(body))continue;
    let at=0;for(const cell of body.split('|')){quoted(cell.replace(/`/g,' '),lineStarts[line]!+at);at+=cell.length+1;}
  }
  for(const m of text.matchAll(/[^\s`"'|(),;<>[\]]+/g))add('word',m[0],m.index);
  const digests:DigestMark[]=[];
  for(const m of text.matchAll(/(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/g))
    digests.push({value:m[0].toLowerCase(),start:m.index,line:index(lineStarts,m.index),paragraph:index(paragraphStarts,m.index),...(strings&&slotAt(m.index)?{slot:slotAt(m.index)!}:{})});
  return {tokens,digests,json:strings!==null};
}
