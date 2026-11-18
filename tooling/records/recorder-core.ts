// Generic recorder transport and ratchet transaction. Families supply every format and identity policy.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {appliedLine,MalformedDelta,parseDelta,serializeDelta,type ApplyCounts,type Delta,type DeltaRow} from './delta.ts';
import {listedIn,pendingLine} from './pending.ts';
import type {RecordRow} from './recorder-format.ts';
export type Part='core'|'wide';
export type Pending={kind:string;name:string;record:string};
export type RecordCase=Omit<Pending,'kind'>;
export type Runner=(args:string[],root:string)=>number;
/** What this records run has written so far: each record path it changed from
 * its committed bytes, with the SHA-256 of the bytes it left there. A path
 * already dirty when the run first touched it never enters the ledger. */
export type RecordRun={readonly written:ReadonlyMap<string,string>};
/** The context of a question asked outside any records run. */
export const NO_RUN:RecordRun={written:new Map()};
export type ApplyOptions={say?:(line:string)=>void;identities?:(root:string,paths:readonly string[])=>Promise<Map<string,{source:string;driver:string}>>};
export interface RecordFamily{
 /** Bind detached input observations to one record/apply transaction. */
 scope?(root:string):RecordFamily;
 pending(root:string,run:RecordRun):RecordCase[];
 files(root:string):readonly string[];
 records(row:DeltaRow):readonly string[];
 runs(pending:readonly Pending[],run:RecordRun):string[][];
 audit(file:string,before:string|null,after:string,pending:ReadonlySet<string>,root?:string):string[];
 rows(file:string,text:string):Map<string,RecordRow>|null;
 changes(kind:string,file:string,before:string|null,after:string):Omit<DeltaRow,'sources'>[];
 validate(row:DeltaRow,bad:(row:DeltaRow,why:string)=>never):void;
 merge(file:string,text:string|null,rows:readonly DeltaRow[],header:string|undefined):string;
 sourceDigests(root:string,names:readonly string[],run:RecordRun):Map<string,string|null>;
 sourceAtApply?(root:string,row:DeltaRow):string|null|undefined;
 /** Why this ready row cannot apply beside the delta's other ready rows, if it cannot. */
 conflict?(root:string,row:DeltaRow,others:readonly DeltaRow[]):string|undefined;
 checkSources?(root:string,rows:readonly DeltaRow[],options:ApplyOptions):Promise<Map<DeltaRow,string>>;
 validateGroup?(rows:readonly DeltaRow[],bad:(row:DeltaRow,why:string)=>never):void;
 partner?(row:DeltaRow,other:DeltaRow):boolean;
 afterRun?(args:readonly string[]):void;
 afterRuns?(root:string,before:ReadonlyMap<string,string|null>,say:(line:string)=>void):number;
 refresh?(root:string):RecordCase[];
 refreshLine?(one:Pending):string;
 listedPending?:boolean;
 pendingFromDelta?:boolean;
 lineHeader?:boolean;
 unreadableRows?:boolean;
}
export type RecordTable=Readonly<Record<string,{family:RecordFamily;steps:readonly string[];part:Part}>>;
const read=(root:string,file:string)=>readFileSync(join(root,file),'utf8');
const inCheckout = (root: string) => existsSync(join(root, ".git"));

/** The files under each of `paths` (a file or a directory): those git tracks in a checkout, else every regular file there. */
function filesUnder(root: string, paths: readonly string[]): Map<string, string[]> {
  const under = new Map(paths.map(path => [path, [] as string[]]));
  if (!inCheckout(root)) {
    for (const path of paths) {
      const full = join(root, path);
      if (!existsSync(full)) continue;
      under.set(path, statSync(full).isDirectory()
        ? readdirSync(full, { withFileTypes: true, recursive: true }).filter(entry => entry.isFile()).map(entry => relative(root, join(entry.parentPath, entry.name)))
        : [path]);
    }
    return under;
  }
  // One listing of the whole tree, each file then given to the path it is under.
  const listed = spawnSync("git", gitArguments(["ls-files", "-z"]), { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  if (listed.status !== 0) throw new Error(`git ls-files in ${root}: ${(listed.stderr ?? listed.error?.message ?? "").trim()}`);
  for (const file of listed.stdout.split("\0").filter(Boolean)) {
    for (let at = file; ; at = at.slice(0, at.lastIndexOf("/"))) {
      under.get(at)?.push(file);
      if (!at.includes("/")) break;
    }
  }
  return under;
}

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function digestSources(root:string,cases:readonly {name:string;paths:readonly string[];except:string|null}[]):Map<string,string|null>{
 const wanted=new Map(cases.map(one=>[one.name,one]));
 const files=filesUnder(root,[...new Set([...wanted.values()].flatMap(one=>one.paths))]);
 const content=new Map<string,string>();const digestOf=(file:string)=>{if(!content.has(file))content.set(file,sha256(readFileSync(join(root,file))));return content.get(file)!;};
 const digests=new Map<string,string|null>();
 for(const [id,{paths,except}]of wanted){const present=[...new Set(paths.flatMap(path=>files.get(path)??[]))].filter(file=>file!==except&&existsSync(join(root,file))).sort();digests.set(id,present.length?sha256(JSON.stringify(present.map(file=>[file,digestOf(file)]))):null);}return digests;
}
/** The path's text at HEAD, or null when HEAD has no such file. */
function committedBytes(root: string, file: string): string | null {
  if (!inCheckout(root)) return null;
  const shown = spawnSync("git", gitArguments(["cat-file", "blob", `HEAD:${file}`]), { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  return shown.status === 0 ? shown.stdout : null;
}
function headCommit(root: string): string | null {
  if (!inCheckout(root)) return null;
  const head = spawnSync("git", gitArguments(["rev-parse", "--verify", "HEAD"]), { cwd: root, encoding: "utf8" });
  return head.status === 0 ? head.stdout.trim() : null;
}

/** A delta written whole and renamed into place, so a reader never sees half of one. */
function keepDelta(file: string, delta: Delta): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, serializeDelta(delta));
  renameSync(partial, file);
}

/** Bind transport to exactly the families this consumer owns. No family is discovered implicitly. */
export function createRecorder(table:RecordTable,defaultRun:Runner=()=>{throw Error('recorder command runner was not supplied');}){
 const KINDS=Object.keys(table);
 const scoped=(root:string)=>createRecorder(Object.fromEntries(Object.entries(table).map(([kind,row])=>[kind,{...row,family:row.family.scope?.(root)??row.family}])),defaultRun);
 const family=(kind:string)=>{const row=table[kind];if(!row)throw new MalformedDelta('malformed records delta: no recorder is of kind '+kind);return row.family;};
 const partOf=(kind:string):Part=>{family(kind);return table[kind]!.part;};
 const findPending=(root:string,kind:string,run:RecordRun=NO_RUN):Pending[]=>family(kind).pending(root,run).map(one=>({kind,name:one.name,record:one.record}));
 const recordFiles=(root:string,kind:string)=>family(kind).files(root);
 const recorderRuns=(kind:string,pending:readonly Pending[],run:RecordRun=NO_RUN)=>family(kind).runs(pending,run);
 const auditRecord=(kind:string,file:string,before:string|null,after:string|null,pending:ReadonlySet<string>,root?:string):string[]=>{if(before===after)return [];assert.ok(after!==null,`${file} was removed`);return family(kind).audit(file,before,after,pending,root);};
 const changedRows=(kind:string,file:string,before:string|null,after:string)=>family(kind).changes(kind,file,before,after);
 const sourceDigests=(root:string,cases:readonly {kind:string;name:string}[],run:RecordRun=NO_RUN):Map<string,string|null>=>{const digests=new Map<string,string|null>();for(const [kind,group]of Map.groupBy(cases,one=>one.kind))for(const [name,digest]of family(kind).sourceDigests(root,group.map(one=>one.name),run))digests.set(`${kind}\0${name}`,digest);return digests;};
function acceptedIn(root: string, run: string): { byKind: Map<string, Pending[]>; pendingByKind: Map<string, Pending[]>; unowned: string[] } {
  const owner = new Map<string, string>();
  for (const kind of KINDS) for (const file of recordFiles(root, kind)) owner.set(file, kind);
  const byKind = new Map<string, Pending[]>(), pendingByKind = new Map<string, Pending[]>(), unowned = new Set<string>();
  const listed = listedIn(run);
  for (const change of listed.accepted) {
    const kind = owner.get(change.record);
    if (kind === undefined) { unowned.add(change.record); continue; }
    byKind.set(kind, [...byKind.get(kind) ?? [], { kind, name: change.name, record: change.record }]);
  }
  for (const one of listed.pending) {
    const kind = owner.get(one.record);
    if (kind !== undefined && family(kind).listedPending) pendingByKind.set(kind, [...pendingByKind.get(kind) ?? [], { kind, name: one.name, record: one.record }]);
  }
  return { byKind, pendingByKind, unowned: [...unowned].sort() };
}

function snapshot(root: string, kind: string, pending: readonly Pending[]): Map<string, string | null> {
  const files = new Set([...recordFiles(root, kind), ...pending.map(one => one.record)]);
  return new Map([...files].map(file => [file, existsSync(join(root, file)) ? read(root, file) : null]));
}

function recordPending(root: string, kinds: readonly string[], run: Runner = defaultRun, say = (line: string) => console.log(line), accepted: ReadonlyMap<string, readonly Pending[]> = new Map(), delta?: string, listed: ReadonlyMap<string, readonly Pending[]> = new Map()): number {
  if(kinds.some(kind=>family(kind).scope))return scoped(root).recordPending(root,kinds,run,say,accepted,delta,listed);
  let failed = 0, recorded = 0;
  const out: Delta = { version: 1, commit: headCommit(root), headers: {}, rows: [] };
  if (delta) keepDelta(delta, out);
  // The run's own write ledger: whether each touched path was committed when
  // the run first changed it, and the bytes the run last left there.
  const committedAtStart = new Map<string, boolean>(), written = new Map<string, string>(), ledger: RecordRun = { written };
  const problem = (kind: string, what: string, error: unknown) => { say(`  ${kind}: REFUSED ${what}: ${error instanceof Error ? error.message : String(error)}`); failed += 1; };
  for (const kind of kinds) {
    let missing: Pending[], refreshes: Pending[];
    // One family's failed question is its own problem; later families still record.
    try {
      missing = [...findPending(root, kind, ledger), ...listed.get(kind) ?? []];
      refreshes = (family(kind).refresh?.(root) ?? []).map(one=>({...one,kind}));
    } catch (error) { problem(kind, "finding its pending cases", error); continue; }
    const pending = [...missing, ...refreshes], changes = accepted.get(kind) ?? [];
    if (!pending.length && !changes.length) { say(`${kind}: nothing pending and no accepted change listed; not run`); continue; }
    say(`${kind}: ${missing.length} pending${refreshes.length ? `, ${refreshes.length} recorded refresh(es)` : ''}${changes.length ? `, ${changes.length} accepted change(s) listed` : ''}`);
    for (const one of missing) say(`  ${pendingLine(one.name, one.record)}`);
    for (const one of refreshes) say(family(kind).refreshLine!(one));
    for (const one of changes) say(`  accepted: ${one.name} in ${one.record}`);
    // New rows are only for missing cases; family audits authorize current
    // observation refreshes and accepted outcome changes.
    const before = snapshot(root, kind, pending);
    for (const args of recorderRuns(kind, [...pending, ...changes], ledger)) {
      say(`  running: node ${args.join(" ")}`);
      const status = run(args, root);
      if (status !== 0) { say(`  ${kind}: the recorder exited ${status}`); failed += 1; }
      else family(kind).afterRun?.(args);
    }
    failed += family(kind).afterRuns?.(root,before,say) ?? 0;
    const changed: Omit<DeltaRow, "sources">[] = [];
    for (const [file, was] of before) {
      const now = existsSync(join(root, file)) ? read(root, file) : null;
      const names = new Set(pending.filter(one => one.record === file).map(one => one.name));
      try {
        for (const row of auditRecord(kind, file, was, now, names, root)) { say(`  recorded ${file}: ${row}`); recorded += 1; }
        if (now !== null && now !== was) changed.push(...changedRows(kind, file, was, now));
      } catch (error) {
        say(`  REFUSED ${error instanceof Error ? error.message : String(error)}; put back as it was`);
        if (was === null) rmSync(join(root, file), { force: true }); else writeFileSync(join(root, file), was);
        failed += 1;
      }
    }
    for (const [file, was] of before) {
      const path = join(root, file), now = existsSync(path) ? readFileSync(path) : null;
      if (now === null ? was === null : was !== null && now.equals(Buffer.from(was))) continue;
      if (!committedAtStart.has(file)) committedAtStart.set(file, was !== null && committedBytes(root, file) === was);
      if (committedAtStart.get(file) && now !== null) written.set(file, sha256(now)); else written.delete(file);
    }
    // A record file outside the snapshot is one no recorder of this kind may write.
    for (const file of recordFiles(root, kind)) {
      if (before.has(file)) continue;
      say(`  REFUSED ${file} was written, and no pending case lacks it; removed`);
      rmSync(join(root, file), { force: true });
      failed += 1;
    }
    if (delta && changed.length) {
      let sources: Map<string, string | null>;
      try { sources = sourceDigests(root, changed.map(row => ({ kind, name: row.case })), ledger); }
      catch (error) { problem(kind, "naming the sources of its rows; they are not in the delta", error); continue; }
      for (const row of changed) {
        const digest = sources.get(`${kind}\0${row.case}`);
        if (!digest) { say(`  REFUSED ${row.record}: ${row.case} is recorded, but none of its sources is in the tree; it is not in the delta`); failed += 1; continue; }
        out.rows.push({ ...row, sources: digest });
        // What a tree without this record yet starts it from.
        if (family(kind).lineHeader) out.headers[row.record] ??= read(root, row.record).split("\n", 1)[0]!;
      }
      keepDelta(delta, out);
    }
  }
  if (delta) say(`record-pending: the delta of its ${out.rows.length} row(s) is ${delta}`);
  say(`record-pending: ${recorded} row(s) recorded${failed ? `, ${failed} problem(s)` : ""}; nothing is committed`);
  return failed ? 1 : 0;
}

function checkDelta(delta:Delta):void{
 const bad=(row:DeltaRow,why:string):never=>{throw new MalformedDelta(`malformed records delta: ${row.record}: ${row.case}: ${why}`);};
 for(const row of delta.rows){if(!KINDS.includes(row.kind))bad(row,`no recorder is of kind ${row.kind}`);const handler=family(row.kind);if(!handler.records(row).includes(row.record))bad(row,`no ${row.kind} recorder writes that record`);handler.validate(row,bad);}
 for(const [record,header]of Object.entries(delta.headers))if(header.includes('\n'))throw new MalformedDelta(`malformed records delta: the header of ${record} is not one line`);
 for(const [kind,rows]of Map.groupBy(delta.rows,row=>row.kind))family(kind).validateGroup?.(rows,bad);
}
async function applyDelta(root: string, delta: Delta, options: ApplyOptions = {}): Promise<ApplyCounts> {
  if(delta.rows.some(row=>table[row.kind]?.family.scope))return scoped(root).applyDelta(root,delta,options);
  const say = options.say ?? ((line: string) => console.log(line));
  checkDelta(delta);
  const counts: ApplyCounts = { applied: 0, already: 0, skipped: 0 };
  const since = delta.commit ? ` since ${delta.commit.slice(0, 12)}` : "";
  const head = headCommit(root);
  say(`record-pending --apply: ${delta.rows.length} row(s) recorded${delta.commit ? ` at ${delta.commit.slice(0, 12)}` : ""}, into ${root}${head ? ` at ${head.slice(0, 12)}` : ""}`);
  const skipped = new Set<DeltaRow>();
  const skip = (row: DeltaRow, why: string) => { skipped.add(row); say(`  skipped ${row.record}: ${row.case}: ${why}; the next records run takes it up`); counts.skipped += 1; };

  // The tree's own records: each one's text, and a line record's rows by key.
  const texts = new Map<string, string | null>(), lines = new Map<string, Map<string, string>>();
  const textOf = (record: string) => {
    if (!texts.has(record)) texts.set(record, existsSync(join(root, record)) ? read(root, record) : null);
    return texts.get(record)!;
  };
  const rowOf = (row: DeltaRow): string | null => {
    const kind = row.kind as string, text = textOf(row.record);
    if(text===null)return null;
    if(!lines.has(row.record)){
      let rows:Map<string,RecordRow>|null;
      if(family(kind).unreadableRows){try{rows=family(kind).rows(row.record,text);}catch{rows=new Map();}}else rows=family(kind).rows(row.record,text);
      if(rows===null)return text;
      lines.set(row.record,new Map([...rows].map(([key,one])=>[key,one.line])));
    }
    return lines.get(row.record)!.get(row.key)??null;
  };
  // The cases pending in the tree, by kind, as every check finds them; or why they cannot be found.
  const pendingByKind = new Map<string, Set<string> | Error>();
  const pendingAt = (kind: string) => {
    if (!pendingByKind.has(kind)) {
      try { pendingByKind.set(kind, new Set(findPending(root, kind).map(one => `${one.record}\0${one.name}`))); }
      catch (error) { pendingByKind.set(kind, error instanceof Error ? error : new Error(String(error))); }
    }
    return pendingByKind.get(kind)!;
  };
  // A compile row is held to its own digests below; every other row to its case's files.
  const sources = sourceDigests(root, delta.rows.filter(row => !family(row.kind).sourceAtApply).map(row => ({ kind: row.kind as string, name: row.case })));

  let ready: DeltaRow[] = [];
  for (const row of delta.rows) {
    const here = rowOf(row);
    if (here === row.after) { say(`  already recorded ${row.record}: ${row.case}`); counts.already += 1; continue; }
    if (here !== row.before) {
      skip(row, here === null ? `its row is gone${since}` : row.before === null ? `a row of another measurement was recorded for it${since}` : `its row changed${since}`);
      continue;
    }
    // A test262 case with no row here may take one: what makes it pending is
    // that it runs now, which the recorder measured; the tree cannot list it.
    if (row.before === null && !family(row.kind).pendingFromDelta) {
      const pending = pendingAt(row.kind as string);
      if (pending instanceof Error) { skip(row, `the pending ${row.kind} cases cannot be listed here: ${pending.message}`); continue; }
      if (!pending.has(`${row.record}\0${row.case}`)) { skip(row, "it is not a pending case here"); continue; }
    }
    let digest: string | null | undefined;
    try { digest = family(row.kind).sourceAtApply ? family(row.kind).sourceAtApply!(root,row) : sources.get(`${row.kind}\0${row.case}`); }
    catch (error) { skip(row, `its sources cannot be named here: ${error instanceof Error ? error.message : String(error)}`); continue; }
    if (digest !== row.sources) { skip(row, digest === null ? "its sources are gone" : `its sources changed${since}`); continue; }
    ready.push(row);
  }

  for(const [kind,group]of Map.groupBy(ready,row=>row.kind)){
    for(const [row,why]of await family(kind).checkSources?.(root,group,options)??[])skip(row,why);
  }
  ready=ready.filter(row=>!skipped.has(row));
  for(const row of ready){const handler=family(row.kind),partner=delta.rows.find(one=>one.kind===row.kind&&handler.partner?.(row,one));if(partner&&skipped.has(partner))skip(row,`its row in ${partner.record} does not apply here`);}
  ready=ready.filter(row=>!skipped.has(row));
  // A row derived from sources another ready row changes is stale beside it.
  const conflicts=ready.flatMap(row=>{const why=family(row.kind).conflict?.(root,row,ready.filter(one=>one!==row&&one.record!==row.record));return why===undefined?[]:[[row,why] as const];});
  for(const [row,why]of conflicts)skip(row,why);
  ready=ready.filter(row=>!skipped.has(row));
  // What is pending is the tree's answer before any row is written.
  for (const kind of new Set(ready.map(row => row.kind as string))) if (!family(kind).pendingFromDelta) pendingAt(kind);

  // Each record takes its rows by its own merge, and what that makes is
  // audited by the rule the recorders' writes are held to. One row the format
  // or the rule refuses keeps no other from its record: each is then taken alone.
  for (const [record, group] of Map.groupBy(ready, row => row.record)) {
    const kind = group[0]!.kind as string, was = textOf(record), pending = pendingAt(kind);
    if (pending instanceof Error && !family(kind).pendingFromDelta) { for (const row of group) skip(row, `the pending ${kind} cases cannot be listed here: ${pending.message}`); continue; }
    // A test262 case is pending here when the delta adds it, it has no row here
    // and its file is the one measured, all of which the rows above passed.
    const names = new Set(family(kind).pendingFromDelta ? group.filter(row => row.before === null).map(row => row.case)
      : pending instanceof Error ? [] : [...pending].filter(id => id.startsWith(`${record}\0`)).map(id => id.slice(record.length + 1)));
    const merge = (text: string | null, these: readonly DeltaRow[]) => {
      const next = family(kind).merge(record,text,these,delta.headers[record]);
      auditRecord(kind, record, text, next, names, root);
      return next;
    };
    let text = was, applied: DeltaRow[] = [];
    try { text = merge(was, group); applied = group; }
    catch {
      for (const row of group) {
        try { text = merge(text, [row]); applied.push(row); }
        catch (error) { skip(row, `its record refuses it here: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    if (!applied.length) continue;
    mkdirSync(dirname(join(root, record)), { recursive: true });
    writeFileSync(join(root, record), text!);
    for (const row of applied) { say(`  applied ${record}: ${row.case} (${row.before === null ? "pending" : "an accepted change"})`); counts.applied += 1; }
  }
  say(appliedLine(counts));
  return counts;
}

async function applyCommand(root: string, args: readonly string[], say = (line: string) => console.log(line)): Promise<number> {
  if (args.length !== 1) { console.error("usage: node tooling/records/record-pending.ts --apply <delta>"); return 2; }
  let delta: Delta;
  try { delta = parseDelta(readFileSync(args[0]!, "utf8")); }
  catch (error) { console.error(`record-pending --apply: ${args[0]}: ${error instanceof Error ? error.message : String(error)}`); return 1; }
  try { await applyDelta(root, delta, { say }); }
  catch (error) {
    if (!(error instanceof MalformedDelta)) throw error;
    console.error(`record-pending --apply: ${args[0]}: ${error.message}`);
    return 1;
  }
  return 0;
}

return {KINDS,partOf,findPending,acceptedIn,recorderRuns,auditRecord,sourceDigests,recordPending,applyDelta,applyCommand};
}
