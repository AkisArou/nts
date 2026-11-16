import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digestSources,type RecordFamily} from '../records/recorder-core.ts';
import {wholeRow,mergeWhole} from '../records/recorder-format.ts';

const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const read=(root:string,file:string)=>readFileSync(join(root,file),'utf8');
import {GENERATOR,recordPath,RECORDS,hintedOracleImprovements,parseShard,oracleImprovementPath,oracleBudgetFixtures,pendingFixtures,type OracleRow} from './oracle-records.ts';
import {oracleBudgetRevision,oracleUnplannedRevision} from './record-oracles.ts';
import type {Pending} from '../records/recorder-core.ts';
export function oracleRefreshes(root:string):Pending[]{
  const names=new Set(hintedOracleImprovements(root));
  for(const name of oracleBudgetFixtures(root)){
    const file=join(root,recordPath(name));if(!existsSync(file))continue;
    const raw=JSON.parse(read(root,recordPath(name)));
    if(!('unplanned' in raw)&&!raw.rows?.some((row:{kind?:string})=>row.kind==='budget'))continue;
    const shard=parseShard(raw,name);
    for(const row of shard.rows)if(row.kind==='budget'&&JSON.stringify(row.revision)!==JSON.stringify(oracleBudgetRevision(root,row.source)))names.add(name);
    // A plan budget's provenance is its fixture's files, its Node, producer and policy.
    if(shard.unplanned&&JSON.stringify(shard.unplanned.revision)!==JSON.stringify(oracleUnplannedRevision(root,name)))names.add(name);
  }
  return [...names].sort().map(name=>({kind:'oracle-counts',name,record:recordPath(name)}));
}

function auditOracleRefresh(file: string, fixture: string, before: string, after: string): string[] {
  const old = JSON.parse(before), next = JSON.parse(after);
  assert.ok(old.rows?.some((row: { kind?: string }) => row.kind === "budget") || "unplanned" in old, `${file}: a recorded population was rewritten; a count has no improvement`);
  const was = parseShard(old, fixture), now = parseShard(next, fixture), improved: string[] = [];
  const unplanned = was.unplanned, same = (a: OracleRow, b: OracleRow) => a.source === b.source && a.signature === b.signature;
  // The backends a row of the plan budget's entry gained, when it gained keys only on backends the budget named.
  const planned = (row: OracleRow, replacement: OracleRow): string[] => {
    if (unplanned?.source !== row.source || JSON.stringify({ ...replacement, keys: row.keys }) !== JSON.stringify(row)) return [];
    const gained = Object.keys(replacement.keys).filter(backend => row.keys[backend] === undefined);
    return gained.length && gained.every(backend => unplanned.backends.includes(backend)) && Object.entries(row.keys).every(([backend, key]) => replacement.keys[backend] === key) ? gained : [];
  };
  for (const row of was.rows) {
    const replacement = now.rows.find(one => same(one, row));
    assert.ok(replacement, "oracle refresh removed a population");
    if (JSON.stringify(row) === JSON.stringify(replacement)) continue;
    const gained = planned(row, replacement);
    if (gained.length) { improved.push(`${row.source} planned on ${gained.join(", ")}`); continue; }
    assert.ok(row.kind === "budget" && (replacement.kind === "measured" || replacement.kind === "budget" && (JSON.stringify(row.revision) !== JSON.stringify(replacement.revision) || JSON.stringify(row.budget)!==JSON.stringify(replacement.budget))), "only a budget -> measured improvement or changed budget identity/classification may replace a recorded row");
    improved.push(row.source + " budget -> " + replacement.kind);
  }
  for (const row of now.rows.filter(one => !was.rows.some(other => same(one, other)))) {
    assert.ok(unplanned?.source === row.source && Object.keys(row.keys).every(backend => unplanned.backends.includes(backend)), "oracle refresh changed its population inventory");
    improved.push(`${row.source} plan budget -> ${row.kind}`);
  }
  if (JSON.stringify(was.unplanned) !== JSON.stringify(now.unplanned)) {
    const changed = now.unplanned;
    if (changed === undefined) improved.push(`${unplanned!.source} plan budget gone: planned on every backend`);
    else if (unplanned?.source === changed.source && JSON.stringify(changed.revision) !== JSON.stringify(unplanned.revision)) improved.push(`${changed.source} plan budget identity changed`);
    else if (unplanned?.source === changed.source && JSON.stringify({ ...changed, backends: unplanned.backends }) === JSON.stringify(unplanned) && changed.backends.every(backend => unplanned.backends.includes(backend))) improved.push(`${changed.source} plan budget narrowed to ${changed.backends.join(", ")}`);
    else {
      assert.ok(unplanned === undefined && !now.rows.some(row => row.source === changed.source && row.kind === "measured" && changed.backends.some(backend => row.keys[backend] !== undefined)), "a plan budget may only narrow, go or change its identity, and a new one cannot replace a measured population");
      improved.push(`${changed.source} budget -> plan budget`);
    }
  }
  assert.ok(improved.length, "a recorded population was rewritten without an improvement");
  return improved;
}


export const oracleFamily:RecordFamily={
pending:root=>pendingFixtures(root).map(name=>({name,record:recordPath(name)})),
 files:root=>!existsSync(join(root,RECORDS))?[]:readdirSync(join(root,RECORDS),{withFileTypes:true,recursive:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.json')).map(entry=>relative(root,join(entry.parentPath,entry.name))).sort(),
 records:row=>{try{return [recordPath(row.case)];}catch{return [];}},
 refresh:oracleRefreshes,refreshLine:one=>`  ORACLE BUDGET refresh ${one.name} (${one.record})`,
 runs:pending=>[...new Set(pending.map(one=>one.name))].map(name=>[relative(SOURCE_ROOT,fileURLToPath(new URL('./record-oracles.ts',import.meta.url))),name]),
 afterRun:args=>{for(const name of args.slice(1))rmSync(oracleImprovementPath(name),{force:true});},
 audit:(file,before,after,pending)=>{const fixture=file.slice(`${RECORDS}/`.length,-'.json'.length);if(before!==null)return auditOracleRefresh(file,fixture,before,after);assert.ok(pending.has(fixture),`${file} was written for ${fixture}, which was not pending`);return [`${fixture} (pending)`];},
 rows:()=>null,validate:wholeRow,merge:mergeWhole,
 changes:(kind,file,before,after)=>{const name=file.slice(`${RECORDS}/`.length,-'.json'.length);return [{kind,record:file,case:name,key:name,before,after}];},
 sourceDigests:(root,names)=>digestSources(root,names.map(name=>({name,paths:[name,GENERATOR],except:null}))),

};
