// Whether a traced workspace test run opened a tracked file that a change could
// alter without owing the Rust tests (#761). Selection owes the tests only for
// what their declared runtime inputs reach, so a test that reads a tracked path
// no rule reaches is a missed obligation: a change to that path would land
// without the test that reads it. This is that check, over the capture
// `tests.mjs` writes when NTS_RUST_INPUT_TRACE names a directory.
//
//   node tooling/gate/rust-input-coverage.ts <trace directory> <report directory>
//   node tooling/gate/rust-input-coverage.ts --reports <report directory>
//
// The validator (rust-input-validation.ts) names each attempt its target's
// declarations do not claim, operation by operation. A candidate on a tracked
// path is then asked of selection, as a change: a file owes the tests when it is
// edited, a listed directory when an entry is added to it or removed, and any other
// directory when some tracked file beneath it does, and the lookup of an absent
// path when a commit adds it. Exit 0: every candidate is reached. Exit 1: the
// missed paths are named. Present untracked bytes (installed packages, output
// the validator could not attribute) and absent paths the commit's own tracked
// .gitignore rules ignore are reported beside them: no commit changes them, so
// they cannot be owed. A host's own excludes never widen that namespace.
// The second form decides again from the validation reports of an earlier run.
import {readFileSync,readdirSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {dirname,join,relative,isAbsolute,sep} from 'node:path';
import {runAsCommand,exitCommand} from '../differential/command-entry/main.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {gitArguments} from './git-arguments/main.ts';
import {rustRuntimeInputGraph} from './rust-runtime-inputs.ts';
import {readRustRuntimeManifest} from './rust-runtime-declarations.ts';
import {RUST_RUNTIME_DECLARATIONS} from './rust-selector-selection.ts';
import {cargoRuntimeTargets} from './cargo-inputs.ts';
import {readDoctestCalls,testArtifactTargets,type RustTarget} from './rust-test-inputs.ts';
import {retainedFileObserverReceipt} from './file-input-observer.ts';
import {validateRustInputCapture,type RuntimeTargetInputs} from './rust-input-validation.ts';
import type {RustInputCapture} from './rust-input-authentication.ts';
import {readRustInputValidation,decodeRustInputSubject} from './rust-input-report.ts';
import {readRustTestExecution} from './rust-test-execution.ts';
import {installationCatalogTrust} from '../inputs/dependency-inputs.ts';
import {durableRecord} from './durable-record.ts';
import {owingByReach} from './owed.mjs';

/** One repository path a test opened without a claim of its target. */
export type CoverageCandidate={path:string;tracked:'file'|'directory'|null;kind:'endpoint'|'component';source:string;phase:string;requirements:string[];reason:string|null};
/** A tracked candidate and the rule that reaches it, or null when none does. */
export type CoverageDecision=CoverageCandidate&{reachedBy:string|null;via:string|null;
  /** For a listed directory: the entry whose removal from it owes nothing. */
  removal?:string};
export type CaptureReport={file:string;target:string|null;repositoryCoverage:string;counts:Record<string,number>};
/** An untracked candidate: generated or stray bytes in the tree, a lookup of
 * an absent path the commit's own .gitignore rules ignore, or an absent directory crossed
 * on the way to another path. None is a commit's input. */
export type UntrackedCandidate=CoverageCandidate&{state:'ignored'|'untracked'|'absent-ignored'|'absent-component'};
export type CoverageResult={missed:CoverageDecision[];reached:CoverageDecision[];untracked:UntrackedCandidate[];captures:CaptureReport[]};
/** The rules a change owes the Rust tests by: owed.mjs's reach, in production. */
export type ReachChange={path:string;added:boolean;deleted?:boolean;sameMode?:boolean;least?:boolean};
/** The rules a commit holding these changes owes the Rust tests by. */
export type TestReach=(changes:readonly ReachChange[])=>readonly string[];
/** Requirements a change to the file's bytes alone can alter: a content read,
 * a write that may read, and what the validator could not classify. Each is
 * decided by the least-owing edit of those bytes. A stat is not: what it
 * decides (Cargo's freshness, a kind) a comment cannot change, so it is decided
 * by an edit in place. */
const BYTE_SENSITIVE=new Set(['content','mutation','unknown']);
export type TrackedPaths={kind(path:string):'file'|'directory'|null;beneath(directory:string):readonly string[];
  /** Whether an untracked path is present in the working tree now. */
  present(path:string):boolean;
  /** Which of these untracked paths Git ignores. */
  ignored(paths:readonly string[]):ReadonlySet<string>};

const git=(root:string,args:string[])=>infrastructureProbe({purpose:'Rust input coverage '+args[0],command:'git',args:gitArguments(args),cwd:root,maxBuffer:1<<28}).stdout;
// The repository root is inside: a test that lists it changes with any new
// top-level entry. Its relative path is ''.
const inside=(root:string,path:string)=>{const part=relative(root,path);return part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};
/** A path in a directory, '' being the root. */
const within=(directory:string,name:string)=>directory?directory+'/'+name:name;
/** A name no tracked directory holds: adding it is the membership question. */
export const MEMBERSHIP_PROBE='nts-rust-input-coverage-probe';

/** Tracked files, and the directories that hold one: a commit's inputs. */
export function trackedPaths(root:string):TrackedPaths{
  const list=git(root,['ls-files','-z']).split('\0').filter(Boolean);
  return trackedFrom(list,{
    present:path=>{try{lstatSync(join(root,path));return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'||(error as NodeJS.ErrnoException).code==='ENOTDIR')return false;throw error;}},
    ignored:paths=>{
      if(!paths.length)return new Set();
      // Every path is answered with the pattern that decided it; check-ignore
      // exits 1 when none is ignored, which is an answer too.
      const result=infrastructureProbe({purpose:'Rust input coverage check-ignore',command:'git',
        args:gitArguments(['-c','core.excludesFile=/dev/null','check-ignore','--no-index','--verbose','--non-matching','-z','--stdin']),cwd:root,
        input:paths.join('\0')+'\0',maxBuffer:1<<28,exits:'classify'});
      if(result.status!==0&&result.status!==1)throw Error('Rust input coverage: git check-ignore exited '+result.status+': '+result.stderr);
      return committedIgnores(result.stdout,new Set(list));
    }});
}

/**
 * The paths of `check-ignore --verbose --non-matching -z` output that the
 * commit's own rules ignore: the deciding pattern is a positive one in a
 * tracked `.gitignore`. Rules outside the commit (the repository's
 * `info/exclude`, a user's excludes file) are this host's, so a path only they
 * ignore is one a commit can still add, and it stays owed.
 */
export function committedIgnores(output:string,tracked:ReadonlySet<string>):Set<string>{
  const fields=output.split('\0');
  if(fields.at(-1)!=='')throw Error('Rust input coverage: unterminated check-ignore output');
  fields.pop();
  if(fields.length%4)throw Error('Rust input coverage: check-ignore output is not source, line, pattern, path records');
  const ignored=new Set<string>();
  for(let at=0;at<fields.length;at+=4){
    const [source,,pattern,path]=fields.slice(at,at+4) as [string,string,string,string];
    if(source&&(source==='.gitignore'||source.endsWith('/.gitignore'))&&tracked.has(source)&&!pattern.startsWith('!'))ignored.add(path);
  }
  return ignored;
}
export function trackedFrom(list:readonly string[],untracked:Pick<TrackedPaths,'present'|'ignored'>):TrackedPaths{
  const files=new Set(list),directories=new Map<string,string[]>();
  if(files.size)directories.set('',[...files]);
  for(const file of files)for(let at=file.lastIndexOf('/');at>0;at=file.lastIndexOf('/',at-1)){
    const directory=file.slice(0,at),members=directories.get(directory);
    if(members)members.push(file);else directories.set(directory,[file]);
  }
  return {kind:path=>files.has(path)?'file':directories.has(path)?'directory':null,beneath:directory=>directories.get(directory)??[],...untracked};
}

/** The candidates of one validation report, by path and target. */
async function candidates(root:string,report:string,tracked:TrackedPaths,into:Map<string,CoverageCandidate>):Promise<void>{
  await readRustInputValidation(report,(value,resolve)=>{
    if(value.kind!=='runtime-subject')return;
    const row=decodeRustInputSubject(value,resolve) as {source:string;phase:string;requirement:{kind:string;query?:string};
      scope:{endpoint?:{scope:string;path:string;state:string}};components:{observation:{path:string};answer:{kind:string;reason?:string}}[];reason?:string};
    const requirement=row.requirement.kind+(row.requirement.query?':'+row.requirement.query:'');
    const note=(path:string,kind:CoverageCandidate['kind'],reason:string|null)=>{
      if(!inside(root,path))return;
      // A final component is its endpoint; one path is one candidate per target.
      const relativePath=relative(root,path),key=JSON.stringify([relativePath,row.source]),seen=into.get(key);
      // Every repository lookup crosses the root: only an operation on it is its own.
      if(relativePath===''&&kind==='component')return;
      // A path traversed only as a component of another records that; its own
      // operations, once seen, replace it.
      const requirements=kind==='endpoint'?[requirement]:['component'];
      if(!seen){into.set(key,{path:relativePath,tracked:tracked.kind(relativePath),kind,source:row.source,phase:row.phase,requirements,reason});return;}
      if(kind==='component')return;
      if(seen.kind!=='endpoint'){seen.kind='endpoint';seen.requirements=requirements;seen.reason=reason??seen.reason;return;}
      seen.requirements=[...new Set([...seen.requirements,requirement])].sort();
    };
    const endpoint=row.scope.endpoint;
    if(endpoint&&endpoint.scope==='repository'&&endpoint.state!=='claimed')note(endpoint.path,'endpoint',row.reason??null);
    for(const component of row.components)if(component.answer.kind!=='claimed')note(component.observation.path,'component',component.answer.reason??null);
  });
}

/** Each direct entry of a directory, with every tracked file under it: the
 * change set that removes that entry from its listing. */
function entries(directory:string,tracked:TrackedPaths):Map<string,string[]>{
  const entries=new Map<string,string[]>();
  for(const file of tracked.beneath(directory)){
    const name=within(directory,file.slice(directory?directory.length+1:0).split('/')[0]!),files=entries.get(name);
    if(files)files.push(file);else entries.set(name,[file]);
  }
  return entries;
}

/** Ask selection whether a change to each tracked candidate owes the tests. */
export function decide(candidates:readonly CoverageCandidate[],tracked:TrackedPaths,reach:TestReach):Omit<CoverageResult,'captures'>{
  const memo=new Map<string,string|null>();
  // `bytes` is the least-owing edit of a file's bytes (a comment, prose), with
  // its mode kept; `edit` is any change of the file in place.
  const owes=(path:string,change:'edit'|'bytes'|'add'='edit')=>{
    const key=change+':'+path;
    if(!memo.has(key))memo.set(key,reach([{path,added:change==='add',...(change==='bytes'?{sameMode:true,least:true}:{})}])[0]??null);
    return memo.get(key)!;
  };
  // Removing an entry deletes every tracked file under it, in one commit.
  const removing=(entry:string,files:readonly string[])=>{
    const key='remove:'+entry;
    if(!memo.has(key))memo.set(key,reach(files.map(path=>({path,added:false,deleted:true})))[0]??null);
    return memo.get(key)!;
  };
  const missed:CoverageDecision[]=[],reached:CoverageDecision[]=[],untracked:UntrackedCandidate[]=[];
  const outside=candidates.filter(candidate=>!candidate.tracked),ignored=tracked.ignored([...new Set(outside.map(candidate=>candidate.path))]);
  for(const candidate of candidates){
    let reachedBy:string|null=null,via:string|null=null;
    if(!candidate.tracked){
      const present=tracked.present(candidate.path);
      if(present||ignored.has(candidate.path)){untracked.push({...candidate,state:present?(ignored.has(candidate.path)?'ignored':'untracked'):'absent-ignored'});continue;}
      // An absent directory traversed toward another path changes no answer
      // until that path itself is added, and every such lookup is its own candidate.
      if(candidate.kind==='component'){untracked.push({...candidate,state:'absent-component'});continue;}
      // A lookup of an absent path a commit could add: adding it must owe the tests.
      via=candidate.path;reachedBy=owes(candidate.path,'add');
    }
    else if(candidate.tracked==='file'){
      // A read the file's bytes decide must survive the edit that owes least,
      // which keeps only its declared byte readers; any other read, any edit.
      reachedBy=owes(candidate.path,candidate.requirements.some(requirement=>BYTE_SENSITIVE.has(requirement))?'bytes':'edit');via=candidate.path;
    }
    else if(candidate.requirements.includes('enumeration')){
      // A listing changes when an entry is added or removed: both must owe
      // the tests.
      via=within(candidate.path,MEMBERSHIP_PROBE);reachedBy=owes(via,'add');
      const removal=reachedBy?[...entries(candidate.path,tracked)].find(([entry,files])=>!removing(entry,files))?.[0]:undefined;
      if(removal!==undefined){missed.push({...candidate,reachedBy:null,via:null,removal});continue;}
    }
    else for(const file of tracked.beneath(candidate.path)){reachedBy=owes(file,'edit');if(reachedBy){via=file;break;}}
    (reachedBy?reached:missed).push({...candidate,reachedBy,via:reachedBy?via:null});
  }
  return {missed,reached,untracked};
}

export type CoverageCapture={file:string;capture:RustInputCapture;execution?:{path:string;sha256:string;bytes:number}};
/** Validate each capture against its target's declarations, then decide. */
export async function coverageOfCaptures(options:{root:string;captures:readonly CoverageCapture[];reports:string;targets:ReadonlyMap<string,RuntimeTargetInputs>;tracked:TrackedPaths;reach:TestReach}):Promise<CoverageResult>{
  mkdirSync(options.reports,{recursive:true});
  const found=new Map<string,CoverageCandidate>(),captures:CaptureReport[]=[];
  for(const {file,capture,execution} of options.captures){
    const output=join(options.reports,file.replace(/\.raw\.gz$/,'')+'.validation.jsonl.gz');
    const checked=await validateRustInputCapture({capture,output,targets:options.targets,...(execution?{execution}:{})});
    captures.push({file,target:capture.target?.source??null,repositoryCoverage:checked.repositoryCoverage,counts:{...checked.counts}});
    await candidates(options.root,output,options.tracked,found);
  }
  durableRecord(join(options.reports,'candidates.json'),{version:1,captures,candidates:sorted(found)});
  return {...decide(sorted(found),options.tracked,options.reach),captures};
}
const sorted=(found:Map<string,CoverageCandidate>)=>[...found.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.source.localeCompare(b.source));

/** Decide again from an earlier run's validation reports. */
export async function coverageOfReports(options:{root:string;reports:string;tracked:TrackedPaths;reach:TestReach}):Promise<CoverageResult>{
  const found=new Map<string,CoverageCandidate>();
  const files=readdirSync(options.reports).filter(name=>name.endsWith('.validation.jsonl.gz')).sort();
  if(!files.length)throw Error('Rust input coverage: no validation reports in '+options.reports);
  for(const file of files)await candidates(options.root,join(options.reports,file),options.tracked,found);
  const prior=existsSync(join(options.reports,'candidates.json'))?(JSON.parse(readFileSync(join(options.reports,'candidates.json'),'utf8')) as {captures:CaptureReport[]}).captures:[];
  return {...decide(sorted(found),options.tracked,options.reach),captures:prior};
}

/** Every capture of one traced run, bound to its Cargo target by its receipt. */
export function traceCaptures(root:string,trace:string):CoverageCapture[]{
  const observer=retainedFileObserverReceipt(JSON.parse(readFileSync(join(trace,'observer-receipt.json'),'utf8')));
  const calls=readDoctestCalls(join(trace,'doctest-calls'));
  const artifacts=testArtifactTargets(JSON.parse(readFileSync(join(trace,'artifacts.json'),'utf8')) as unknown,root);
  const manifest=JSON.parse(readFileSync(join(trace,'executions.json'),'utf8')) as {version:number;executions:{path:string;sha256:string;bytes:number}[]};
  if(manifest.version!==1||!Array.isArray(manifest.executions))throw Error('Rust input coverage: unreadable execution manifest');
  const byRaw=new Map<string,{reference:{path:string;sha256:string;bytes:number};target:RustTarget}>();
  for(const reference of manifest.executions){
    const receipt=readRustTestExecution(reference),raw=receipt.raw.path;
    if(dirname(raw)!==trace)throw Error('Rust input coverage: execution receipt outside its trace: '+raw);
    if(JSON.stringify(artifacts.get(receipt.executable.path))!==JSON.stringify(receipt.target))throw Error('Rust input coverage: receipt target differs from Cargo artifact: '+raw);
    byRaw.set(raw,{reference,target:receipt.target});
  }
  const raws=readdirSync(trace).filter(name=>/^(cargo|binary-\d+)\.raw\.gz$/.test(name)).sort();
  if(raws.length!==byRaw.size+1||!raws.includes('cargo.raw.gz'))throw Error(`Rust input coverage: ${raws.length} captures for ${byRaw.size} replayed binaries and Cargo`);
  return raws.map(file=>{
    const raw=join(trace,file),execution=byRaw.get(raw);
    if(file!=='cargo.raw.gz'&&!execution)throw Error('Rust input coverage: capture has no execution receipt: '+file);
    return {file,capture:{raw,index:raw.replace(/\.raw\.gz$/,'.index.jsonl.gz'),cwd:root,root,observer,
      ...(execution?{target:execution.target}:{doctestCalls:calls})},...(execution?{execution:execution.reference}:{})};
  });
}

/** The declared runtime inputs of every Cargo target in this tree: the same
 * canonical graph selection reads. */
export function declaredRustInputs(root:string):Map<string,RuntimeTargetInputs>{
  const shared=dirname(git(root,['rev-parse','--path-format=absolute','--git-common-dir']).trim());
  const graph=rustRuntimeInputGraph({sourceRoot:root,dependencyCatalog:installationCatalogTrust(shared,root),inventory:cargoRuntimeTargets(root),
    manifest:readRustRuntimeManifest(join(root,RUST_RUNTIME_DECLARATIONS)),nodeMajor:26});
  const targets=new Map<string,RuntimeTargetInputs>();
  try{for(const row of graph.describeAll())targets.set(row.target.source,{target:row.target,snapshot:row.snapshot});graph.assertComplete();}
  finally{graph.close();}
  return targets;
}

/** Selection's own answer: the rules other than the every-change policy. */
export const testReach:TestReach=changes=>owingByReach(changes,'tests');

export function describeCoverage(result:CoverageResult,limit=40):string[]{
  const line=(gap:CoverageDecision)=>`    ${gap.path||'(the repository root)'} (${gap.tracked??'absent'}, ${gap.requirements.join('+')}, ${gap.phase} of ${gap.source}${gap.reason?': '+gap.reason:''}${gap.removal?'; removing '+gap.removal+' owes nothing':''})`;
  const states=new Map<string,number>();for(const row of result.untracked)states.set(row.state,(states.get(row.state)??0)+1);
  const lines=[`  ${result.captures.length} captures; ${result.reached.length+result.missed.length} candidate(s) a commit can change: ${result.reached.length} reached by selection, ${result.missed.length} missed;`
    +` ${result.untracked.length} outside every commit (${[...states].map(([state,count])=>count+' '+state).join(', ')||'none'})`];
  if(result.missed.length){
    lines.push('  paths a Rust test opened that a commit can change without owing the tests (declare them in '+RUST_RUNTIME_DECLARATIONS+'):');
    for(const gap of result.missed.slice(0,limit))lines.push(line(gap));
    if(result.missed.length>limit)lines.push(`    ... and ${result.missed.length-limit} more`);
  }
  return lines;
}

runAsCommand(import.meta.url,async()=>{
  const argv=process.argv.slice(2),again=argv[0]==='--reports';
  const [trace,reports]=again?[undefined,argv[1]]:argv;
  if(!reports||!isAbsolute(reports)||!again&&(!trace||!isAbsolute(trace)||!existsSync(trace))||argv.length!==2){
    console.error('usage: rust-input-coverage.ts <absolute trace directory> <absolute report directory> | --reports <absolute report directory>');exitCommand(2);return;
  }
  const root=git(process.cwd(),['rev-parse','--show-toplevel']).trim(),tracked=trackedPaths(root);
  const result=again?await coverageOfReports({root,reports,tracked,reach:testReach})
    :await coverageOfCaptures({root,captures:traceCaptures(root,trace!),reports,targets:declaredRustInputs(root),tracked,reach:testReach});
  durableRecord(join(reports,'coverage.json'),{version:2,...result});
  for(const line of describeCoverage(result))console.log(line);
  exitCommand(result.missed.length?1:0);
});
