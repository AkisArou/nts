import {oracleToolchainLocation} from "../gate/canonical-environment.ts";
// The Node output of the exact materialized census project. Scripts share one
// realm; module cases retain their module goal and their fixture imports.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { flagsOf } from "./project.ts";
import { oracle } from "./suites/typescript.ts";
import {prepareOracle,oracleExecution,oracleLoaderReady,oracleRuntimeFile,finishOracleSnapshot,closeOracleExecution,type OraclePrepared} from "../differential/oracle-emit.ts";
import type { PrintedOutput } from "../conformance/output-prefix.ts";

export type OutputOracle = { ok: true; output: PrintedOutput } | { ok: false; why: string };

export async function outputOracle(project: string, scratch: string, body: string, tools,
  bounded: (command: string, args: string[]) => string[]): Promise<OutputOracle> {
  if (tools.language === "ts") {
    let output: PrintedOutput = { stdout: "", stderr: "" };
    const admitted = await oracle(body, scratch, (stdout, stderr) => { output = { stdout, stderr }; });
    return admitted.ok ? { ok: true, output } : admitted;
  }
  const marker = join(scratch, "output-oracle-terminal.json");
  const driver = join(scratch, "output-oracle.mjs");
  const harness = join(project, "src/harness.ts");
  const snapshotOwner=await prepareOracle({entry:harness,project:join(project,'tsconfig.json'),directory:join(scratch,'output-oracle-harness'),runtimeRoots:[join(project,'src')],toolchain:oracleToolchainLocation()});
  let execution:OraclePrepared|undefined,finalized=false;
  try{
  const stored=JSON.parse(readFileSync(snapshotOwner.manifest,'utf8')) as {sources:Record<string,string>};
  const emitted=stored.sources[harness];
  if(!emitted)return {ok:false,why:'output oracle harness has no owner-emitted output'};
  const emittedHarness=join(dirname(snapshotOwner.manifest),emitted),capturedMain=oracleRuntimeFile(snapshotOwner,join(project,'src/main.js'));
  rmSync(marker, { force: true });
  writeFileSync(driver, `
import { readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import {randomUUID} from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
const src = ${JSON.stringify(dirname(capturedMain))};
const logicalSrc = ${JSON.stringify(join(project, "src"))};
const marker = ${JSON.stringify(marker)};
const harness = join(logicalSrc, "harness.ts");
// This driver is sealed: importing a repository helper would change its loader
// closure. test-readiness.ts verifies this one inline atomic publisher instead.
function publishOracleTerminal(record) {
  const temporary = marker + "." + randomUUID() + ".partial";
  writeFileSync(temporary, JSON.stringify(record));
  renameSync(temporary, marker);
}
try {
  vm.runInThisContext(readFileSync(${JSON.stringify(emittedHarness)}, "utf8"), {filename:harness});
  for (const name of readdirSync(src).filter(name => name.startsWith("include-")).sort()) {
    const file = join(src, name);
    vm.runInThisContext(readFileSync(file, "utf8"), {filename:join(logicalSrc,name)});
  }
} catch (error) {
  publishOracleTerminal({complete:false, why:String(error)});
  process.exit(2);
}
try {
  const main = join(src, "main.js");
  ${flagsOf(body).includes("module")
    ? 'await import(pathToFileURL(main).href);'
    : 'vm.runInThisContext(readFileSync(main, "utf8"), {filename:join(logicalSrc,"main.js")});'}
  await new Promise(resolve => setImmediate(resolve));
  publishOracleTerminal({complete:true});
} catch (error) {
  // A source throw is a complete Node observation. A process exit, signal,
  // timeout, or failed harness setup leaves no successful terminal marker.
  publishOracleTerminal({complete:true, thrown:String(error)});
  process.exitCode = 1;
}
`);
  execution=oracleExecution(snapshotOwner,driver);
  const run = (tools.phaseCosts?.spawn.bind(tools.phaseCosts)??spawnSync)("sh", bounded(process.execPath, [...execution.args,"--no-warnings", driver]), {
    encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024,env:{...process.env,...execution.env},
  });
  const snapshot=finishOracleSnapshot(snapshotOwner);finalized=true;
  if(!snapshot.ready)return {ok:false,why:snapshot.why};
  const loader=oracleLoaderReady(execution);
  if(!loader.ready)return {ok:false,why:loader.why};
  if (run.error || run.signal || (run.status !== 0 && run.status !== 1)) {
    return { ok: false, why: `output oracle: ${run.error?.message ?? run.signal ?? `exit ${run.status}`}` };
  }
  try {
    const terminal = JSON.parse(readFileSync(marker, "utf8"));
    if (terminal.complete === true) return { ok: true, output: { stdout: run.stdout ?? "", stderr: run.stderr ?? "" } };
    return { ok: false, why: `output oracle setup: ${terminal.why}` };
  } catch {
    return { ok: false, why: "output oracle ended without its terminal observation" };
  }
  }finally{
    try{if(!finalized){const snapshot=finishOracleSnapshot(snapshotOwner);if(!snapshot.ready)throw Error(snapshot.why);}}
    finally{if(execution)closeOracleExecution(execution);}
  }
}
