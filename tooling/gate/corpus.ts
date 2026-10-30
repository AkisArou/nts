// The stable landing sample has zero compiler and output failures.
// The full upstream selection remains a separate survey until its own ratchet.
// An explicit root gives tests and independent runs private worker/report paths.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {parseCheckStops, reportCheckFailure} from "../differential/check-report.ts";
import {instrumentPolicy, publishHung, publishRunaway, publishToolingFailure, ToolingInstrumentError} from "./step-result.ts";

export function verificationStops(rows: string) {
  const stops: ReturnType<typeof parseCheckStops> = [];
  let failures=0;
  for(const line of rows.split('\n').filter(Boolean)) {
    const row=JSON.parse(line),examined=row?.examined;
    assert.ok(examined&&typeof examined==='object'&&!Array.isArray(examined),'invalid corpus verification row');
    assert.equal(typeof examined.uncompilable,'boolean');assert.equal(typeof examined.unverifiable,'boolean');
    const outcome=examined.outcome;
    const kind=typeof outcome==='string'?outcome:Object.keys(outcome??{})[0];
    assert.ok(['Lowered','Refused','Rejected','Failed','Invalid','Crashed'].includes(kind),'unknown corpus observation');
    if(typeof outcome==='string')assert.ok(['Lowered','Rejected','Invalid'].includes(kind),'invalid corpus unit observation');
    else {
      assert.deepEqual(Object.keys(outcome),[kind],'ambiguous corpus observation');
      if(kind==='Refused')assert.ok(Array.isArray(outcome[kind])&&outcome[kind].every(value=>typeof value==='string'),'invalid corpus refusals');
      else assert.ok(['Failed','Crashed'].includes(kind)&&typeof outcome[kind]==='string','invalid corpus failure');
    }
    if(examined.uncompilable||examined.unverifiable||['Failed','Invalid','Crashed'].includes(kind))failures++;
    stops.push(...parseCheckStops(examined.incomplete??[]));
  }
  return {stops,failures};
}

export function main(args: readonly string[]): number {
  const [root, mode] = args;
  if (!root || mode !== "core") {
    console.error("usage: corpus.ts root core");
    return 2;
  }
  const report = join(root, "target", "suite-report.txt");
  mkdirSync(join(root, "target"), { recursive: true });
  const rows=join(root,'target','suite-rows.jsonl');writeFileSync(rows,'');
  const fd = openSync(report, "w");
  const result = spawnSync(process.env.NTS_SUITE_BIN ?? join(root, "target/release/nts-suite"),
    ["--root", root, "--rows", rows],
    { stdio: ["ignore", fd, fd], env: process.env });
  closeSync(fd);
  const text = readFileSync(report, "utf8");
  try {
    const {stops,failures}=verificationStops(readFileSync(rows,'utf8'));
    if(stops.length) {
      process.stdout.write(text);
      const stop=stops.find(stop=>stop.kind==='tooling-setup')??stops.find(stop=>stop.kind==='runaway')??stops[0]!;
      if(stop.kind==='tooling-setup')publishToolingFailure(new ToolingInstrumentError('tooling-setup',stop.reason));else if(stop.kind==='hung')publishHung(stop.reason,process.env,failures);else publishRunaway(stop.reason,process.env,failures);
      return instrumentPolicy(stop.kind,failures)?.disposition==='verdict'?1:124;
    }
  } catch(error) {return reportCheckFailure(new ToolingInstrumentError('tooling-setup',`invalid corpus verification evidence: ${String(error)}`));}
  if (result.status !== 0) {
    process.stdout.write(text);
    console.error(result.error?.message ?? `suite exit ${result.status}, signal ${result.signal}`);
    console.log("  ^ TypeScript corpus did not finish");
    return 1;
  }
  for (const line of text.split("\n")) {
    if (/single-file|lowered completely|refused a construct|rejected by|frontend failed|invalid HIR|compiler crashed|uncompilable C|unverifiable class/.test(line)) {
      console.log(line);
    }
  }
  if (!/^[1-9]\d* single-file cases$/m.test(text)) {
    console.log("  ^ TypeScript corpus measured no cases");
    return 1;
  }
  // A failed checker never reached HIR. Its zero invalid count cannot pass.
  // HIR validity does not prove C syntax; C/LLVM pointer erasure also cannot
  // prove JVM class types. Each independently measured row must remain zero.
  // The JVM backend step separately requires a JDK; no-JDK is not verification.
  for (const [row, reason] of [
    ["frontend failed", "frontend failures must be zero"],
    ["invalid HIR", "invalid HIR must be zero"],
    ["compiler crashed", "compiler crashes must be zero"],
    ["uncompilable C", "uncompilable C must be zero"],
    ["unverifiable class", "unverifiable class must be zero"],
  ]) {
    const counts = [...text.matchAll(new RegExp(`^\\s+${row}\\s+(\\d+)$`, "mg"))];
    if (counts.length !== 1 || Number(counts[0][1]) !== 0) {
      console.log(`  ^ ${reason}`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
