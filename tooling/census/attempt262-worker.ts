// One worker of `conformance262.ts`: reads a Test262 path per stdin line,
// writes one JSON outcome per stdout line, in order.
//
//   node tooling/census/attempt262-worker.ts <scratch> <nts> <cc> <suite> [memory-cap-kb] [object-cache] [backend] [fresh] [js|ts]
//
// `<suite>` is the root the paths are relative to; the last argument is the
// language the cases are written in (`project.ts` `Language`).
//
// **One workspace per worker, never shared.** `attempt` writes `src/main.js`
// and then compiles it, so two attempts in one directory race on that file and
// each reports a bucket for a program the other wrote -- `run262.ts` records
// two runs doing exactly that, an hour apart, with nothing in either report to
// say so. The orchestrator gives every worker its own `<scratch>`.
//
// The isolation a test needs is still one process per test: `emit-c`, `cc` and
// the program are each a child of this worker, so nothing a test does to its
// process survives into the next one. This process only loops.

import { rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { attempt } from "./attempt262.ts";
import { inResidentWorker } from "./worker-memory.ts";
import { workspace } from "./project.ts";
import { oracle } from "./suites/typescript.ts";
import type { PrintedOutput } from "../conformance/output-prefix.ts";
import { OracleWorker } from "../differential/oracle-emit.ts";
import { oracleToolchainLocation } from "../gate/canonical-environment.ts";
import { OracleFilesystem } from '../differential/oracle-filesystem.ts';
import type { TypeScriptOracleCapture } from './typescript-oracle-capture.ts';
import { oracleResultHash,openTypeScriptOracleResults } from './typescript-oracle-results.ts';
import { typescriptOracleIdentity } from './suites/typescript.ts';

const [scratch, nts, cc, suite, memoryCapKb, objectCache, backend, fresh, language, referenceInputs] = process.argv.slice(2);
const tools = {
  nts,
  cc,
  memoryCapKb: Number(memoryCapKb ?? 0),
  objectCache,
  backend: backend ?? "c",
  fresh: fresh === "fresh",
  language: language === "ts" || language === 'oracle' ? ("ts" as const) : ("js" as const),
};
if (!inResidentWorker()) throw new Error("resident cap: census worker was started without its bounded scope");
const dir = workspace(scratch, tools.language);

if(language==='ts'&&['typescript-c','typescript-llvm','typescript-jvm'].includes(process.env.NTS_GATE_STEP??'')&&!process.env.NTS_TYPESCRIPT_ORACLE)
  throw new Error('TypeScript backend step has no run-owned oracle reference');
const reference=language!=='oracle'&&tools.language==='ts'&&process.env.NTS_TYPESCRIPT_ORACLE
  ?openTypeScriptOracleResults(JSON.parse(process.env.NTS_TYPESCRIPT_ORACLE),oracleResultHash(JSON.stringify(typescriptOracleIdentity()))):undefined;

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let sourceOracle:OracleWorker|undefined;
try{
for await (const path of lines) {
  if (path === "") continue;
  let outcome;
  try {
    const sourceFiles=new OracleFilesystem(),source=sourceFiles.readFile(join(suite,path));
    if(source===null)throw new Error('case source is missing: '+path);
    // A TypeScript case is admitted by node first: one node fails is a wrong
    // case, and is reported as that rather than measured against nts.
    let oracleOutput: PrintedOutput | undefined;
    // The feed already holds this case's token and resident scope. Preparation
    // never runs ahead of dispatch, and its snapshot closes before the row.
    let capture:TypeScriptOracleCapture|undefined;
    if(tools.language==='ts'&&!reference)sourceOracle??=new OracleWorker(join(scratch,'oracle-worker'),oracleToolchainLocation());
    const reused=reference?.get(path,oracleResultHash(source));
    if(reused)oracleOutput=reused.printed;
    const admitted = reused?.verdict??(tools.language === "ts" ? await oracle(source, dir, (stdout, stderr) => { oracleOutput = { stdout, stderr }; },sourceOracle,
      language==='oracle'?{projectDirectory:join(referenceInputs!,oracleResultHash(path)),outputDirectory:join(scratch,'reference-output'),record:value=>{capture=value;}}:undefined) : { ok: true as const });
    if(language==='oracle'){
      if(!capture||!oracleOutput||!admitted.ok&&!admitted.rejection)throw new Error('TypeScript oracle was not measured: '+(!admitted.ok?admitted.why:path));
      outcome={bucket:'oracle-reference',session:capture.session,result:{version:1,path,sourceSha256:oracleResultHash(source),verdict:admitted,printed:oracleOutput,
        observations:[...sourceFiles.captured(),...capture.observations],...(capture.dependencyObservations?{dependencyObservations:capture.dependencyObservations}:{})}};
    }else outcome = admitted.ok ? await attempt(dir, source, { ...tools, oracleOutput }, join(suite, path))
      : admitted.rejection ? {bucket:"oracle-rejected",why:admitted.why,rejection:admitted.rejection}
      : {bucket:"oracle",why:admitted.why};
  } catch (error) {
    // A throw out of `attempt` is this instrument failing, not the test: it is
    // reported as such, never dropped, so the orchestrator's reconciliation
    // still counts one row per case.
    outcome = {
      bucket: "infrastructure-error",
      why: `the attempt threw: ${String(error?.stack ?? error)}`,
    };
  }
  // The build directory holds a full runtime copy per case; `/tmp`-style
  // inode exhaustion is how a long run on this box dies, so it goes now.
  rmSync(join(dir, "out"), { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ path, ...outcome })}\n`);
}
}finally{sourceOracle?.close();}
