// The census report's one reader and writer: what conformance262.ts --report
// writes for a whole directory, and what the conformance summary reads.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { testScratch } from "../gate/test-scratch.ts";
import { censusReportPath, parseCensusReport, serializeCensusReport, writeCensusReport, type CensusReport } from "./census-report.ts";

const report: CensusReport = {
  version: 1, under: "test/harness", backend: "c", pin: "14e8c908e54ae2e770e473bcacf536f8cb654929", compiler: "ec324a1b0ba036a9",
  commit: "6".repeat(40), harness: "bbd3d84004e74dad", degraded: false, selected: 116, cases: 116, attempted: 113,
  outcomes: { pass: 17, fail: 0, refused: 93, unsupported: 6, "no-verdict": 0 },
  inScope: { cases: 83, pass: 17 }, excluded: 33, negativesAccepted: 0,
  notAttempted: { "harness:NTS1001 `X`, a class used as a value": 3, "harness:$262": 3 },
  refused: { "checker (TS)": 3, "lowering (NTS1xxx)": 90 },
};

test("a report is written in one order, its counts largest first, and reads back as written", t => {
  const text = serializeCensusReport(report);
  assert.deepEqual(Object.keys(JSON.parse(text).refused), ["lowering (NTS1xxx)", "checker (TS)"]);
  assert.deepEqual(Object.keys(JSON.parse(text).notAttempted), ["harness:$262", "harness:NTS1001 `X`, a class used as a value"]);
  assert.deepEqual(parseCensusReport(text), JSON.parse(text));
  assert.equal(serializeCensusReport(parseCensusReport(text)), text);
  const file = censusReportPath(testScratch(t, "census-report"), "llvm", "harness");
  assert.match(file, /test262-census\/llvm\/harness\.json$/);
  writeCensusReport(file, report);
  assert.equal(readFileSync(file, "utf8"), text);
});

test("a report whose parts do not add up, or that lacks a part, is an error, not a report", () => {
  const broken = (change: (r: Record<string, unknown>) => void) => {
    const r = JSON.parse(serializeCensusReport(report)) as Record<string, unknown>;
    change(r);
    return JSON.stringify(r);
  };
  const outcomes = (r: Record<string, unknown>) => r.outcomes as Record<string, number>;
  assert.throws(() => parseCensusReport(broken(r => { outcomes(r).pass = 18; }), "x.json"), /x\.json: the outcomes sum to 117, not its 116 case\(s\)/);
  assert.throws(() => parseCensusReport(broken(r => { delete outcomes(r)["no-verdict"]; outcomes(r).timeout = 0; })), /outcomes\.no-verdict is not a count/);
  assert.throws(() => parseCensusReport(broken(r => { (r.refused as Record<string, number>)["other"] = 1; })), /the refused families sum to 94, not its 93 refused/);
  assert.throws(() => parseCensusReport(broken(r => { (r.notAttempted as Record<string, number>)["harness:$262"] = 2; })), /the causes not attempted sum to 5, not its 6 unsupported/);
  assert.throws(() => parseCensusReport(broken(r => { r.excluded = 32; })), /83 in scope and 32 excluded are not its 116 case\(s\)/);
  assert.throws(() => parseCensusReport(broken(r => { r.selected = 115; })), /116 case\(s\) of a selection of 115/);
  assert.throws(() => parseCensusReport(broken(r => { delete r.refused; })), /no refused/);
  assert.throws(() => parseCensusReport(broken(r => { r.version = 2; })), /version 2, not 1/);
  assert.throws(() => parseCensusReport("{"), /not JSON/);
});

test("--report counts a whole directory: a sample, a record's cases or another record's paths is refused before anything runs", t => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  if (!existsSync(join(root, "third_party/test262"))) return t.skip("no test262 checkout");
  const scratch = testScratch(t, "census-report-cli"), out = join(scratch, "report.json");
  for (const selection of [["--sample", "3"], ["--recorded", "results/test262/c/harness.tsv"], ["--paths-from", "results/test262/c/harness.tsv"], ["--suite", "typescript"]]) {
    const run = spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--under", "test/harness", "--report", out, ...selection], {
      cwd: root, encoding: "utf8", env: { ...process.env, NTS_BIN: process.execPath, NTS_CENSUS_DIR: join(scratch, "census") },
    });
    assert.equal(run.status, 2, `${selection.join(" ")}: ${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /--report counts a whole test262 directory/);
    assert.ok(!existsSync(out));
  }
});
