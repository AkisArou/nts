import assert from 'node:assert/strict';
import {existsSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digestSources,type RecordFamily} from '../records/recorder-core.ts';
import {wholeRow} from '../records/recorder-format.ts';

const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const read=(root:string,file:string)=>readFileSync(join(root,file),'utf8');
import {ARMS,COMPILE_ARMS,compileTimeModules,readCounterTable,calibrationEntries,tableLines,withCalibrationEntries,withTableLines,type CompileArm} from './compile-counter.ts';
function compileTimeArm(record: string): CompileArm | null {
  return ARMS.find(arm => COMPILE_ARMS[arm].table === record || COMPILE_ARMS[arm].calibration === record) ?? null;
}
const isCompileTable = (record: string) => ARMS.some(arm => COMPILE_ARMS[arm].table === record);
/** Every compile-time record: each arm's table and its evidence. */
const COMPILE_TIME_RECORDS = ARMS.flatMap(arm => [COMPILE_ARMS[arm].table, COMPILE_ARMS[arm].calibration]);
/** A compile-time record's rows by module: a table's lines, or the evidence's entries, each one line. */
const compileRows = (record: string, text: string) => isCompileTable(record) ? tableLines(text) : calibrationEntries(text);

function auditCompileTimes(file: string, before: string | null, after: string, pending: ReadonlySet<string>): string[] {
  assert.ok(before !== null, `${file} was created; a compile-time record is written whole by a full --record`);
  const table = isCompileTable(file);
  if (table) {
    // A legacy single-compiler table names its compiler; the first row published names each row's instead.
    const provenance = `# compiler-provenance: per-module in ${COMPILE_ARMS[compileTimeArm(file)!].calibration}`;
    const header = (text: string) => text.split("\n").filter(line => line.startsWith("#")).map(line => line.startsWith("# compiler-sha256:") ? provenance : line);
    assert.deepEqual(header(after), header(before), `${file}: the header changed`);
  } else {
    const rest = (text: string) => {
      const { modules: _, tripwire_policy: { observed_max_spread: __, ...policy }, ...record } = JSON.parse(text);
      return { ...record, policy };
    };
    assert.deepEqual(rest(after), rest(before), `${file}: its policy or work profile changed`);
  }
  // A table line's count is its second column; an entry's, its median.
  const count = (line: string) => table ? Number(line.split("\t")[1]) : (JSON.parse(line) as { median_instructions: number }).median_instructions / 1e9;
  const was = compileRows(file, before), now = compileRows(file, after), recorded: string[] = [];
  for (const [module, line] of was) {
    const next = now.get(module);
    assert.ok(next !== undefined, `${file}: the row of ${module} was removed`);
    if (next === line) continue;
    assert.ok(count(next) < count(line), `${file}: the row of ${module} was rewritten, and the ratchet does not accept it`);
    recorded.push(`${module} ${count(line).toFixed(3)} G -> ${count(next).toFixed(3)} G (improved)`);
  }
  for (const [module, line] of now) {
    if (was.has(module)) continue;
    assert.ok(pending.has(module), `${file}: a row was added for ${module}, which was not pending`);
    recorded.push(`${module} ${count(line).toFixed(3)} G (pending)`);
  }
  return recorded;
}

function unpairedCompileTimes(root: string, before: ReadonlyMap<string, string | null>, say: (line: string) => void): number {
  let unpaired = 0;
  for (const arm of ARMS) {
    const files = [COMPILE_ARMS[arm].table, COMPILE_ARMS[arm].calibration];
    const modules = (file: string) => {
      try { return existsSync(join(root, file)) ? JSON.stringify([...compileRows(file, read(root, file)).keys()].sort()) : null; }
      catch { return null; }
    };
    const [listed, proved] = files.map(modules);
    if (listed !== null && listed === proved) continue;
    say(`  REFUSED ${files.join(" and ")} do not list the same modules; both put back as they were`);
    for (const file of files) {
      const was = before.get(file);
      if (was === null || was === undefined) rmSync(join(root, file), { force: true }); else writeFileSync(join(root, file), was);
    }
    unpaired += 1;
  }
  return unpaired;
}


export const compileTimesFamily:RecordFamily={
pending:root=>ARMS.flatMap(arm=>{const {table,calibration}=COMPILE_ARMS[arm],recorded=readCounterTable(read(root,table),arm).rows;return compileTimeModules(root).filter(name=>!recorded.has(name)).flatMap(name=>[{name,record:table},{name,record:calibration}]);}),
 files:()=>COMPILE_TIME_RECORDS,records:()=>COMPILE_TIME_RECORDS,
 runs:pending=>{const runs=new Map<string,string[]>();for(const one of pending){const arm=compileTimeArm(one.record);if(arm)runs.set(`${arm}\0${one.name}`,[relative(SOURCE_ROOT,fileURLToPath(new URL('./compile-counter-calibrate.ts',import.meta.url))),'--arm',arm,'--module',one.name,'--record']);}return [...runs.keys()].sort().map(key=>runs.get(key)!);},
 unreadableRows:true,
 afterRuns:unpairedCompileTimes,audit:auditCompileTimes,
 rows:(file,text)=>new Map([...compileRows(file,text)].map(([name,line])=>[name,{name,line}])),
 changes:(kind,file,before,after)=>{const was=before===null?new Map<string,string>():compileRows(file,before);return [...compileRows(file,after)].filter(([module,line])=>was.get(module)!==line).map(([module,line])=>({kind,record:file,case:module,key:module,before:was.get(module)??null,after:line}));},
 validate:(row,bad)=>{wholeRow(row,bad);for(const line of [row.before,row.after]){if(line===null)continue;let found=new Map<string,string>();try{found=compileRows(row.record,isCompileTable(row.record)?`${line}\n`:`{"modules":[${line}]}`);}catch{/* not a row */}if(line.includes('\n')||found.size!==1||found.get(row.case)!==line)bad(row,'it is not one row of its case');}},
 validateGroup:(rows,bad)=>{for(const row of rows){const arm=compileTimeArm(row.record)!,other=isCompileTable(row.record)?COMPILE_ARMS[arm].calibration:COMPILE_ARMS[arm].table;if(!rows.some(one=>one.record===other&&one.case===row.case))bad(row,`it comes without its row in ${other}`);}},
 partner:(row,other)=>other!==row&&other.case===row.case&&compileTimeArm(other.record)===compileTimeArm(row.record),
 merge:(file,text,rows)=>{assert.ok(text!==null,'there is no such record; a compile-time record is written whole by a full --record');const updates=new Map(rows.map(row=>[row.key,row.after]));return isCompileTable(file)?withTableLines(text,updates):withCalibrationEntries(text,updates);},
sourceDigests:(root,names)=>digestSources(root,names.map(name=>({name,paths:[name],except:null}))),

};
