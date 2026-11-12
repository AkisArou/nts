// Documentation numbering, benchmark evidence and cheap oracle identity inputs.
import {readdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {checkRecords as checkBenchmarkRecords} from "../bench/run-record.ts";
import {readRecords} from "../differential/oracle-records.ts";
import {oracleIdentityProblems,oracleIdentityScope} from "./oracle-record-identities.ts";

// Existing collisions are named, never allowed by count: fixing one cannot
// spend its allowance on a new collision. This list only shrinks.
export const KNOWN_DUPLICATE_RECORDS=["0099","0102","0116","0120"] as const;

export function recordNumbers(names:readonly string[],known:readonly string[]=KNOWN_DUPLICATE_RECORDS) {
  const files=new Map<string,string[]>();
  for(const name of [...names].sort()) {
    const number=/^[0-9]{4}/.exec(name)?.[0];
    if(number)files.set(number,[...(files.get(number)??[]),name]);
  }
  const duplicates=[...files].filter(([,names])=>names.length>1);
  return {
    count:[...files.values()].reduce((count,names)=>count+names.length,0),
    unexpected:duplicates.filter(([number])=>!known.includes(number)),
    stale:known.filter(number=>!duplicates.some(([duplicate])=>duplicate===number)),
  };
}

export function checkRecords(root:string,report:(message:string)=>void,env:NodeJS.ProcessEnv):void {
  const numbers=recordNumbers(readdirSync(join(root,"docs/records")));
  if(numbers.unexpected.length)throw new Error([
    "a record number was claimed twice:",
    ...numbers.unexpected.flatMap(([,files])=>files.map(file=>"  docs/records/"+file)),
    "renumber the later one; tooling/gate/claim-record.sh takes the next free",
  ].join("\n"));
  if(numbers.stale.length)throw new Error("fixed, so remove from KNOWN_DUPLICATE_RECORDS: "+numbers.stale.join(" "));
  checkBenchmarkRecords(root);
  const problems=oracleIdentityProblems(root,readRecords(root).rows,env);
  report(oracleIdentityScope());
  if(problems.length)throw Error(problems.join("\n"));
  report(`${numbers.count} records, ${KNOWN_DUPLICATE_RECORDS.length} numbers claimed twice and named; benchmark run records and table validated`);
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const [root,...extra]=process.argv.slice(2);
    if(!root||extra.length)throw new Error("usage: records.ts <root>");
    checkRecords(resolve(root),console.log,process.env);
  }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
