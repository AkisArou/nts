import {oracleToolchainLocation} from "../../gate/canonical-environment.ts";
// The TypeScript conformance suite's selection: every case under
// `tests/typescript/<under>`, as the records `nts-test262-protocol select`
// writes for test262, so the runner treats both suites alike.
//
// A case is a strict TypeScript file with test262's front matter. Its
// `features:` name the concepts it exercises; they are the suite's index from
// concept to case, and the report's by-feature section. A TypeScript case has
// no negatives (a program that must not compile is `tests/refusals`'s), no
// includes and no flags beyond `module` and `async`.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync, mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { bodyOf, featuresOf, flagsOf, harnessFor, harnessHashOf, harnessObservations } from "../project.ts";
import { REPOSITORY,OracleWorker,removeOracleSnapshot,oracleExecution,oracleLoaderReady,closeOracleExecution,oracleIdentity,finishOracleSnapshot } from "../../differential/oracle-emit.ts";
import {ToolingInstrumentError} from '../../gate/step-result.ts';
import {captureTypeScriptOracle,type TypeScriptOracleCapture} from '../typescript-oracle-capture.ts';

const ORACLE_FILE = "oracle.ts";
const sourceHash = (file: URL) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** A raw checkpoint measures this source oracle, not only the nts binary. */
export function typescriptOracleIdentity() {
  return {
    oracle: oracleIdentity(oracleToolchainLocation()),
    materializer: {
      roots: [ORACLE_FILE],
      producer: "pinned transpileModule",
      harness: harnessHashOf("ts"),
      suiteSha256: sourceHash(new URL(import.meta.url)),
      preparationSha256: sourceHash(new URL("../attempt262-worker.ts",import.meta.url)),
      referenceSources: ['../typescript-oracles.ts','../typescript-oracle-results.ts','../typescript-oracle-capture.ts'].map(file=>[file,sourceHash(new URL(file,import.meta.url))]),
      workspaceSha256: sourceHash(new URL("../project.ts", import.meta.url)),
      fixtureOptionsSha256: sourceHash(new URL("../../../tsconfig.fixtures.json", import.meta.url)),
    },
  };
}

/** The record one case is selected as, in the protocol's shape. */
export type Selected = {
  path: string;
  schedule: "planned";
  variant_id: string;
  strict_prefix: string;
  includes: string[];
  features: string[];
  flags: string[];
  source_hash: string;
  body_hash: string;
  function_token: false;
};

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Every `.ts` case under `root/under`, sorted by path. */
export function selectTypescript(root: string, under: string): Selected[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts")) files.push(path);
    }
  };
  walk(join(root, under));
  return files.map((file) => {
    const source = readFileSync(file, "utf8");
    const path = relative(root, file);
    return {
      path,
      schedule: "planned",
      variant_id: `${path}#strict`,
      strict_prefix: "",
      includes: [],
      features: featuresOf(source),
      flags: flagsOf(source),
      source_hash: hash(source),
      body_hash: hash(bodyOf(source)),
      function_token: false,
    };
  });
}

function typeScriptOracleBody(source: string): string { return `${harnessFor(source)}\n${bodyOf(source)}\nexport {};\n`; }

/** The selected suite is authored as .ts; its harness supplies ESM scope. */
export function materialiseTypeScriptOracle(source: string, scratch: string): string {
  const file = join(scratch, "oracle.ts");
  writeFileSync(join(scratch, "package.json"), JSON.stringify({type: "module"}) + "\n");
  writeFileSync(file, typeScriptOracleBody(source));
  return file;
}

/** Create the original inputs before the first capture consults their parent
 * listings. Executable snapshots live elsewhere and can be released at once. */
export function materialiseTypeScriptOracleProject(source:string,directory:string):string{
  mkdirSync(directory,{recursive:true});
  const file=materialiseTypeScriptOracle(source,directory);
  writeFileSync(join(directory,'oracle.js'),'');
  writeFileSync(join(directory,'tsconfig.json'),JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),files:[file],include:[]})+'\n');
  return file;
}

/** A completed failure is a case observation; missing execution is held. */
export type OracleRejection={exit:number;error:string};
export type OracleVerdict={ok:true}|{ok:false;why:string;rejection?:OracleRejection};
export type OracleReferenceCapture={projectDirectory:string;outputDirectory:string;record:(capture:TypeScriptOracleCapture)=>void};

/** Transform the one-file harness and case, then execute its captured JS.
 * Type errors are the native compiler's question, not Node's admission rule.
 * One pinned transpileModule path handles every TypeScript case. */
export async function oracle(source:string,scratch:string,printed?:(output:string,errors:string)=>void,worker?:OracleWorker,reference?:OracleReferenceCapture):Promise<OracleVerdict>{
  const own=reference?.projectDirectory??(worker?join(scratch,'oracle-project'):mkdtempSync(join(scratch,'oracle-project-')));
  mkdirSync(own,{recursive:true});
  let producer=worker,snapshotOwner:Awaited<ReturnType<OracleWorker['prepare']>>|undefined,execution:ReturnType<typeof oracleExecution>|undefined,finalized=false;
  try{
    const file=materialiseTypeScriptOracle(source,own),project=join(own,'tsconfig.json');
    const config=reference?join(REPOSITORY,'tsconfig.fixtures.json'):join(scratch,'tsconfig.json');
    writeFileSync(project,JSON.stringify({extends:existsSync(config)?config:join(REPOSITORY,'tsconfig.fixtures.json'),files:[file],include:[]})+'\n');
    producer??=new OracleWorker(join(own,'producer'),oracleToolchainLocation());
    const entry=join(own,'oracle.js');writeFileSync(entry,'');
    const transformed=producer.transpileModule(file,project);
    writeFileSync(entry,transformed.text);
    if(transformed.map)writeFileSync(entry+'.map',transformed.map);
    snapshotOwner=await producer.prepare({toolchain:oracleToolchainLocation(),entry,project:null,roots:[entry],
      observations:[...transformed.observations,...harnessObservations()],directory:reference?.outputDirectory??join(own,'oracle-emit')});
    if(JSON.parse(readFileSync(snapshotOwner.manifest,'utf8')).groups.length!==0)throw new ToolingInstrumentError('tooling-setup','transpiled TypeScript case required an unplanned checked Program');
    execution=oracleExecution(snapshotOwner);
    const run=spawnSync(process.execPath,[...execution.args,'--no-warnings',entry],{encoding:'utf8',timeout:30_000,env:{...process.env,...execution.env}});
    const snapshot=finishOracleSnapshot(execution);finalized=true;
    if(!snapshot.ready)return {ok:false,why:snapshot.why};
    printed?.(run.stdout??'',run.stderr??'');
    const loader=oracleLoaderReady(execution);
    if(!loader.ready)return {ok:false,why:loader.why};
    if(run.signal||run.error||run.status===null)return {ok:false,why:`node was not measured: ${run.signal??run.error?.message??'missing exit status'}`};
    reference?.record(captureTypeScriptOracle(snapshotOwner));
    if(run.status!==0){
      const said=(run.stderr??'')+(run.stdout??''),line=said.split('\n').find(text=>/Error|error/.test(text))??said.split('\n')[0]??'';
      const error=line.trim().slice(0,200)||`node exited ${run.status}`;
      return {ok:false,why:error,rejection:{exit:run.status,error}};
    }
    if(flagsOf(source).includes('async')&&!/^Test262:AsyncTestComplete$/m.test(run.stdout??'')){
      const failure=/^Test262:AsyncTestFailure:.*$/m.exec(run.stdout??'')?.[0],error=(failure??'the async case never called $DONE').slice(0,200);
      return {ok:false,why:error,...(failure?{rejection:{exit:run.status,error}}:{})};
    }
    return {ok:true};
  }finally{
    try{if(snapshotOwner&&!finalized){const result=finishOracleSnapshot(snapshotOwner);if(!result.ready)throw new ToolingInstrumentError('tooling-setup',result.why);}}
    finally{
      if(execution)closeOracleExecution(execution);
      if(!worker)producer?.close();
      if(reference)removeOracleSnapshot(reference.outputDirectory);
      else if(worker)removeOracleSnapshot(own);
    }
  }
}
