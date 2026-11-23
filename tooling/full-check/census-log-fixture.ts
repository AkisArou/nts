// Exercise the production recorded-C census function, stubbing only its producer.
import assert from "node:assert/strict";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import type {TestContext} from "node:test";
import {fileInput} from "../gate/reader-inputs/main.ts";
import {fixtureEnvironment} from "../gate/test-environment.ts";
import {testScratch} from "../gate/test-scratch.ts";
import {spawnTest} from "../gate/test-wait.ts";

const GATE = fileInput(new URL("../gate/all.sh", import.meta.url));

export function censusReport(rows: string[], kind = "REGRESSED"): string {
  return [
    "  census start: fixture", "  pass-count: 1", "  negatives-accepted: 0",
    "  against results/fixture.tsv:",
    ...["REGRESSED", "CHANGED", "MISSING"].flatMap(category => [
      `         ${category === kind ? rows.length : 0}  ${category}`,
      ...(category === kind ? rows.map(row => `              ${row}`) : []),
    ]),
    "  NOT RECONCILED: the recorded outcomes changed; see above, then re-record with --record if intended",
  ].join("\n");
}

export function recordedCensus(t: TestContext, raw: string, status: 0 | 1 = 1) {
  const root = testScratch(t, "recorded-census-log"), bin = join(root, "bin"), input = join(root, "raw.txt");
  mkdirSync(bin); mkdirSync(join(root, "third_party/test262/.git"), {recursive: true});
  const fn = readFileSync(GATE, "utf8").match(/^test262_recorded\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(fn, "extract the production function, including its sole log filter");
  writeFileSync(input, raw);
  writeFileSync(join(bin, "node"), '#!/bin/sh\ncat "$CENSUS_RAW"\nexit "$CENSUS_STATUS"\n', {mode: 0o755});
  const script = join(root, "recorded.sh");
  writeFileSync(script, `jobs=24\n${fn}\ntest262_recorded test/language results/fixture.tsv\n`);
  const env = fixtureEnvironment(t, {CENSUS_RAW: input, CENSUS_STATUS: String(status)});
  return spawnTest("sh", [script], {cwd: root, encoding: "utf8", env: {...env, PATH: `${bin}:${env.PATH}`}});
}
