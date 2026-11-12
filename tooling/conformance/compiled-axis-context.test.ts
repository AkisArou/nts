import {fixtureEnvironment} from "../gate/test-environment.ts";
// The actual axis and runner, with one small compiled C addon. Only the build
// command is a fixture: context, dependency preparation and both test arms run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { copyModuleClosure } from "../gate/module-closure-fixture.ts";
import { oracleWorkspaceFixture } from "../differential/oracle-workspace-fixture.ts";
import { hostEnvironment } from "../gate/canonical-environment.ts";
import { newToolingSlice, stopToolingSlice, toolingSlice } from "../gate/tooling-slice.ts";
import { newTestScratch } from "../gate/test-scratch.ts";
import { ownMemory } from "../gate/test-memory.ts";
import { removable } from "../gate/run-temporary.ts";
import { spawnTest } from "../gate/test-wait.ts";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
const shell = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

function fixture(t: TestContext) {
  const root = newTestScratch("compiled-axis-context"), units: string[] = [], inherited = toolingSlice(), slice = inherited ?? newToolingSlice(true);
  // The module is a declared runtime root, so its addon directory carries
  // the complete native-module resolution context into preparation too.
  const out = join(root, "runtime/node/subject/addons");
  const write = (name: string, text: string) => { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  t.after(() => {
    for (const unit of units) spawnSync("systemctl", ["--user", "stop", unit], {env:fixtureEnvironment(t), stdio: "ignore" });
    if (!inherited) stopToolingSlice(slice);
    removable(root); rmSync(root, { recursive: true, force: true });
  });
  copyModuleClosure([new URL("./compiled-axis.ts",import.meta.url),new URL("./run.mjs",import.meta.url),new URL("./run-one.mjs",import.meta.url)].map(url=>relative(SOURCE,fileURLToPath(url))), root);
  // run-one loads these finite runtime roots dynamically, beyond the static
  // import graph copied above. Preparation captures the real implementations.
  copyModuleClosure([new URL("./common.mjs",import.meta.url),new URL("./tmpdir.mjs",import.meta.url),new URL("./fixtures.mjs",import.meta.url),new URL("./hijackstdio.mjs",import.meta.url),new URL("./run-cjs-worker.mjs",import.meta.url)]
    .map(url=>relative(SOURCE,fileURLToPath(url))), root);
  oracleWorkspaceFixture(t, root);
  // The real preparation worker keeps every imported TypeScript file in its
  // original project. Configs are runtime assets, outside the import graph.
  const config = JSON.parse(readFileSync(new URL("./tsconfig.json",import.meta.url), "utf8"));
  copyModuleClosure(config.files.map((name: string) => "tooling/conformance/" + name), root);
  for (const name of ["tsconfig.base.json", "tsconfig.fixtures.json", "tooling/conformance/tsconfig.json"])
    write(name, readFileSync(join(SOURCE, name), "utf8"));
  write("runtime/node/subject/tsconfig.json", '{"files":["src/main.ts"]}\n');
  write("runtime/node/subject/src/main.ts", "export const value = 7;\n");
  write("third_party/node/test/fixtures/utf8_test_text.txt", readFileSync(join(SOURCE, "third_party/node/test/fixtures/utf8_test_text.txt"), "utf8"));
  write("third_party/node/test/parallel/test-subject.js", "require('node:assert/strict').equal(require('subject').value,7);\n");
  write("subject.c", `#include <node_api.h>
static napi_value init(napi_env env, napi_value exports) {
  napi_value value; napi_create_int32(env, 7, &value);
  napi_set_named_property(env, exports, "value", value); return exports;
}
NAPI_MODULE(subject, init)
`);
  const headers = [join(SOURCE, "third_party/node/src"), join(SOURCE, "node_modules/node-api-headers/include"),
    join(dirname(dirname(process.execPath)), "include/node")].find(path => existsSync(join(path, "node_api.h")));
  assert.ok(headers, "the fixture needs the pinned Node API headers");
  const built = spawnTest("cc", ["-shared", "-fPIC", "-I", headers, join(root, "subject.c"), "-o", join(root, "subject.node")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  write("tooling/conformance/build.sh", `#!/bin/sh\nset -eu\ncommand cp ${shell(join(root, "subject.node"))} "$NTS_ADDON_OUT/$1.node"\n`);
  const runner = join(root, "tooling/conformance/run.mjs"), observation = join(root, "contexts.jsonl");
  let text = readFileSync(runner, "utf8");
  text = text.replace("{gateEnvironment,sealOracleRun}", "{gateEnvironment,sealOracleRun,ownedCacheEnvironment}");
  const start = "planned=await sealOracleRun(planned);environment=planned.env;";
  assert.ok(text.includes(start));
  text = text.replace(start, start + `
const observedContext=JSON.parse(environment.NTS_GATE_ENV_CONTEXT),observedCap=JSON.parse(environment.NTS_ORACLE_DEPENDENCIES);
writeFileSync(${JSON.stringify(observation)},JSON.stringify({phase:process.argv.includes('--empty-exports')?'empty':'intact',
 temporary:observedContext.temporary,dependencies:observedCap.directory,seal:observedCap.seal?.record,
 cache:ownedCacheEnvironment(environment,{temporary:environment.TMPDIR}).TMPDIR})+'\\n',{flag:'a'});
`);
  const harness = "if (publishesNothing) {";
  text = text.replace(harness, `writeFileSync(${JSON.stringify(observation)},JSON.stringify({phase:process.argv.includes('--empty-exports')?'empty':'intact',harnessCache:ownedCacheEnvironment(childEnvironment,{temporary:childEnvironment.TMPDIR}).TMPDIR})+'\\n',{flag:'a'});\n` + harness);
  writeFileSync(runner, text);
  const memory = ownMemory(join(root, "memory")), home = join(root, "home"); mkdirSync(home);
  write("unit.mjs", `import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {gateEnvironment,hostEnvironment,sealOracleRun} from './tooling/gate/canonical-environment.ts';
import {finishRunTemporary} from './tooling/gate/run-temporary.ts';
const [mode]=process.argv.slice(2),root=${JSON.stringify(root)},memory=${JSON.stringify(memory)};
const run=join(root,'home/.cache/outer'),out=${JSON.stringify(out)};
let planned=gateEnvironment(hostEnvironment(process.env),{run,oracleRoot:root,oracleAdmissionContext:'gate',owned:{...memory,NTS_TOOLING_SLICE:${JSON.stringify(slice)},NTS_ADDON_OUT:out}});
Object.assign(process.env,planned.env);
if(mode==='sealed')planned=await sealOracleRun(planned);
const ledger=join(run,'oracle-dependency-calls.jsonl');
const calls=()=>existsSync(ledger)?readFileSync(ledger,'utf8').trim().split('\\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const before=calls().length,cap=JSON.parse(planned.env.NTS_ORACLE_DEPENDENCIES);
const child=spawn(process.execPath,[join(root,'tooling/conformance/compiled-axis.ts'),'subject'],{env:planned.env,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;process.stderr.write(data);});
const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
process.stdout.write(stdout);
writeFileSync(join(root,'outcome.json'),JSON.stringify({mode,before,newCalls:calls().slice(before),outer:planned.temporary.path,dependencies:cap.directory,seal:cap.seal?.record,status,stdout,stderr}));
finishRunTemporary(planned.temporary,planned.env.HOME,status===0);
process.exitCode=status;
`);
  const run = (mode: string) => {
    const unit = `nts-test-compiled-axis-${randomUUID()}`; units.push(unit);
    const env = { ...hostEnvironment(process.env), HOME: home, TMPDIR: join(home, ".cache/unit") };
    mkdirSync(env.TMPDIR, { recursive: true });
    const setenv = Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([name, value]) => `--setenv=${name}=${value}`);
    return spawnTest("systemd-run", ["--user", `--slice=${slice}`, `--unit=${unit}`, "--collect", "--wait", "--pipe", "--quiet",
      "--property=LimitCORE=0", "--property=Nice=19", "--property=CPUAffinity=0-3 6-31", "--property=RuntimeMaxSec=300s", "--property=TimeoutStopSec=5s",
      `--working-directory=${root}`, ...setenv, process.execPath, join(root, "unit.mjs"), mode], { encoding: "utf8" });
  };
  return { root, out, observation, run };
}

for (const mode of ["unsealed", "sealed"]) test(`compiled axis preserves the ${mode} outer context through intact and empty arms`, t => {
  const f = fixture(t), ran = f.run(mode);
  const logs = ["subject.intact.log", "subject.empty.log"].map(name => {
    const file = join(f.out, name); return existsSync(file) ? readFileSync(file, "utf8") : "";
  }).join("\n");
  assert.equal(ran.status, 0, ran.stdout + ran.stderr + logs);
  const outcome = JSON.parse(readFileSync(join(f.root, "outcome.json"), "utf8"));
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.match(outcome.stdout, /subject\s+1 real, 0 hollow/);
  const observations = readFileSync(f.observation, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const contexts = observations.filter(row => row.temporary);
  assert.deepEqual(contexts.map(row => row.phase), ["intact", "empty"]);
  for (const context of contexts) {
    assert.equal(context.temporary.enclosing?.path, outcome.outer, "the tooling child keeps its outer registered temporary");
    assert.equal(context.dependencies, outcome.dependencies);
    assert.ok(context.seal, "the runner sees a sealed dependency image");
    if (mode === "sealed") assert.equal(context.seal, outcome.seal);
    assert.equal(context.cache, context.temporary.path, "ownedCacheEnvironment accepts the tooling child");
  }
  if (mode === "sealed") {
    assert.ok(outcome.newCalls.length > 0, "the real children consult the dependency image");
    assert.ok(outcome.newCalls.every(row => row.mode === "hit" && row.sealed === true && row.helperProcess === false && row.pnpmSelectionCommands === 0),
      "sealed children reuse the pinned image without capture, helper process or package selection");
  } else assert.ok(outcome.newCalls.some(row => row.mode === "cold"), "the unsealed run prepares under the outer authority");
  assert.deepEqual(observations.filter(row => row.harnessCache).map(row => row.phase), ["intact", "empty"], "both harness children pass ownedCacheEnvironment");
  const harnessEnvironment = JSON.parse(readFileSync(join(f.out, "axis.environment.json"), "utf8"));
  assert.equal(harnessEnvironment.NTS_GATE_ENV_CONTEXT, undefined, "the direct Node harness boundary stays context-free");
  for (const phase of ["intact", "empty"]) {
    const report = JSON.parse(readFileSync(join(f.out, `subject.${phase}.json`), "utf8"));
    assert.ok(report.expected > 0);
  }
});
