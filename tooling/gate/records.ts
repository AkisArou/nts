// Documentation numbering, benchmark evidence and cheap oracle identity inputs.
import {existsSync,lstatSync,readFileSync,readdirSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {checkRecords as checkBenchmarkRecords} from "../bench/run-record.ts";
import {pendingFixtures,readRecords,recordPath} from "../differential/oracle-records.ts";
import {pendingLine} from "../records/pending.ts";
import {oracleIdentityProblems,oracleIdentityScope} from "./oracle-record-identities.ts";
import {dataDirectory,fileInput} from './reader-inputs/main.ts';
import {durableRecord} from './durable-record.ts';
import {KNOWN_DUPLICATE_RECORDS,recordNumbers} from './record-numbers.ts';

const SOURCE=fileURLToPath(new URL('../..',import.meta.url));
const RECORD_DIRECTORY=relative(SOURCE,fileURLToPath(dataDirectory(new URL('../../docs/records/',import.meta.url))));
const BENCHMARK_STORE=dataDirectory(new URL('../../results/benchmarks/',import.meta.url));
export const RECORD_SIZES=relative(SOURCE,fileURLToPath(fileInput(new URL('../../results/record-sizes.json',import.meta.url))));
export const DECISION_TABLE_BYTES=16*1024;
const RECORD_RULE='committed records are Markdown plus the decision table; raw output stays in kept scratch, cited by path and SHA-256';
export type RecordSizes={version:1;files:Record<string,number>};
const inRoot=(root:string,input:URL)=>join(root,relative(SOURCE,fileURLToPath(input)));

const recordName=(file:string)=>file.startsWith(RECORD_DIRECTORY+'/')&&!file.endsWith('.md')
  &&!file.includes('\\')&&!file.includes('\0')&&!file.split('/').some(part=>part===''||part==='.'||part==='..');
export function parseRecordSizes(value:unknown):RecordSizes {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid record size ratchet');
  const row=value as {version?:unknown;files?:unknown};
  if(row.version!==1||!row.files||typeof row.files!=='object'||Array.isArray(row.files))throw Error('invalid record size ratchet');
  const files:Record<string,number>={};
  for(const [file,size] of Object.entries(row.files)){
    if(!recordName(file)||!Number.isSafeInteger(size)||Number(size)<0)throw Error('invalid record size ratchet row: '+file);
    files[file]=Number(size);
  }
  return {version:1,files};
}

/** The legacy ratchet owns regular files only; Markdown is written evidence. */
export function recordSizes(root:string):Record<string,number> {
  const files:Record<string,number>={};
  const walk=(directory:string):void=>{
    for(const entry of readdirSync(join(root,directory),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=directory+'/'+entry.name;
      if(entry.isDirectory())walk(file);
      else {
        if(!entry.isFile())throw Error('record must be an owned regular file: '+file);
        if(!file.endsWith('.md'))files[file]=lstatSync(join(root,file)).size;
      }
    }
  };
  walk(RECORD_DIRECTORY);return files;
}

export function recordSizeProblems(actual:Record<string,number>,previous:RecordSizes):string[] {
  const problems:string[]=[];
  for(const [file,size] of Object.entries(actual)){
    const legacy=Object.hasOwn(previous.files,file),table=/\.(?:tsv|csv)$/.test(file);
    const bound=legacy?previous.files[file]!:table?DECISION_TABLE_BYTES:0;
    if((!legacy&&!table)||size>bound)
      problems.push(`${file}: ${size} bytes; bound ${bound} bytes (${legacy?'recorded size may only fall':'only .md or a small .tsv/.csv decision table may be added'}); ${RECORD_RULE}`);
  }
  return problems;
}

export function checkRecordSizes(root:string):void {
  const path=join(root,RECORD_SIZES),previous=parseRecordSizes(JSON.parse(readFileSync(path,'utf8')));
  const problems=recordSizeProblems(recordSizes(root),previous);
  if(problems.length)throw Error(problems.join('\n'));
}

/** Only the --record route publishes this ratchet. It cannot accept growth. */
function recordSizeRatchet(root:string,initialize:boolean):void {
  const path=join(root,RECORD_SIZES),present=existsSync(path);
  if(initialize&&present)throw Error('record size ratchet already exists; --initialize cannot replace it');
  if(!initialize&&!present)throw Error('record size ratchet is missing; first publication requires --record --initialize');
  const files=recordSizes(root),previous=initialize?undefined:parseRecordSizes(JSON.parse(readFileSync(path,'utf8')));
  const problems=previous?recordSizeProblems(files,previous):[];
  if(problems.length)throw Error(problems.join('\n'));
  durableRecord(path,{version:1,files});
  console.log(`record size ratchet: ${Object.keys(files).length} non-Markdown files recorded`);
}

export function checkRecords(root:string,report:(message:string)=>void,env:NodeJS.ProcessEnv):void {
  checkRecordSizes(root);
  const numbers=recordNumbers(readdirSync(join(root,RECORD_DIRECTORY)));
  if(numbers.unexpected.length)throw new Error([
    "a record number was claimed twice:",
    ...numbers.unexpected.flatMap(([,files])=>files.map(file=>"  docs/records/"+file)),
    "renumber the later one; tooling/gate/claim-record.sh takes the next free",
  ].join("\n"));
  if(numbers.stale.length)throw new Error("fixed, so remove from KNOWN_DUPLICATE_RECORDS: "+numbers.stale.join(" "));
  const store=inRoot(root,BENCHMARK_STORE);
  checkBenchmarkRecords(root,{runs:join(store,'runs'),table:join(store,'full.md')});
  const problems=oracleIdentityProblems(root,readRecords(root).rows,env);
  report(oracleIdentityScope());
  if(problems.length)throw Error(problems.join("\n"));
  for(const fixture of pendingFixtures(root))report(pendingLine(fixture,recordPath(fixture)));
  report(`${numbers.count} records, ${KNOWN_DUPLICATE_RECORDS.length} numbers claimed twice and named; benchmark run records and table validated`);
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const [root,...extra]=process.argv.slice(2),record=extra.includes('--record'),initialize=extra.includes('--initialize');
    if(!root||extra.some(arg=>!['--record','--initialize'].includes(arg))||initialize&&!record)
      throw new Error("usage: records.ts <root> [--record [--initialize]]");
    if(record)recordSizeRatchet(resolve(root),initialize);
    else checkRecords(resolve(root),console.log,process.env);
  }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
