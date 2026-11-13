// Documentation numbering, benchmark evidence and cheap oracle identity inputs.
import {readdirSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {checkRecords as checkBenchmarkRecords} from "../bench/run-record.ts";
import {pendingFixtures,readRecords,recordPath} from "../differential/oracle-records.ts";
import {pendingLine} from "../records/pending.ts";
import {oracleIdentityProblems,oracleIdentityScope} from "./oracle-record-identities.ts";
import {dataDirectory} from './reader-inputs/main.ts';
import {KNOWN_DUPLICATE_RECORDS,recordNumbers} from './record-numbers.ts';

const SOURCE=fileURLToPath(new URL('../..',import.meta.url));
const RECORD_DIRECTORY=relative(SOURCE,fileURLToPath(dataDirectory(new URL('../../docs/records/',import.meta.url))));
const BENCHMARK_STORE=dataDirectory(new URL('../../results/benchmarks/',import.meta.url));
const inRoot=(root:string,input:URL)=>join(root,relative(SOURCE,fileURLToPath(input)));

export function checkRecords(root:string,report:(message:string)=>void,env:NodeJS.ProcessEnv):void {
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
    const [root,...extra]=process.argv.slice(2);
    if(!root||extra.length)throw new Error("usage: records.ts <root>");
    checkRecords(resolve(root),console.log,process.env);
  }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
