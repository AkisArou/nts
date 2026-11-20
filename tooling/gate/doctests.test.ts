import {testEnvironment} from "./test-environment.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// doctests.ts with a stand-in cargo that records how it was called. The
// variables it reads are the test's own: a run's NTS_TEST_PROFILE is not.
function doctests(env: Record<string, string | undefined>) {
  const root = mkdtempSync(join(tmpdir(), "doctest-command-"));
  try {
    const capture = join(root, "args.json"), cargo = join(root, "cargo");
    const profile=readFileSync(new URL("../../Cargo.toml",import.meta.url),"utf8").split(/(?=^\[)/m).find(part=>part.startsWith("[profile.nts-dev]"));
    writeFileSync(join(root,"Cargo.toml"),"[workspace]\n"+profile);
    writeFileSync(cargo, `#!${process.execPath}
const {durableRecord}=require(${JSON.stringify(new URL("./durable-record.ts",import.meta.url).pathname)});
const {mkdirSync}=require('node:fs'),{join}=require('node:path'),args=process.argv.slice(2);
if(args.includes('--list')){
  mkdirSync(process.env.CARGO_TARGET_DIR,{recursive:true});
  console.log(JSON.stringify({reason:'compiler-artifact',filenames:[join(process.env.CARGO_TARGET_DIR,'nts-dev/libnts_core.rlib')],profile:{debuginfo:0},fresh:false}));
  console.log(JSON.stringify({reason:'build-finished',success:true}));
}else{
  durableRecord(process.env.DOC_CAPTURE,{args,checkers:process.env.NTS_CHECKERS,incremental:process.env.CARGO_INCREMENTAL});process.exit(7);
}
`);
    chmodSync(cargo, 0o755);
    writeFileSync(join(root,'rustup'),'#!/bin/sh\nprintf \'no overrides\\n\'\n',{mode:0o755});
    const environment={...testEnvironment(),PATH:root,DOC_CAPTURE:capture,NTS_CHECKERS:'9',CARGO_INCREMENTAL:undefined,NTS_TEST_PROFILE:undefined,
      CARGO_TARGET_DIR:join(root,'target'),NTS_BUILD_DOCTESTS:'1',NTS_DOCTEST_PREPARATION:join(root,'prepared.json'),...env};
    const prepared=spawnSync(process.execPath,[new URL('./build.ts',import.meta.url).pathname,'--profile','nts-dev','--no-compiler'],{cwd:root,encoding:'utf8',env:environment});
    const run=prepared.status===0?spawnSync(process.execPath,[new URL('./doctests.ts',import.meta.url).pathname],{cwd:root,encoding:'utf8',env:environment}):prepared;
    let called: unknown = null;
    try { called = JSON.parse(readFileSync(capture, "utf8")); } catch { /* cargo was not called */ }
    return { run, called };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("doc-only checks select the named crates, keep failures and bound checker pools", () => {
  const { run, called } = doctests({ NTS_DOCTEST_CRATES: "nts-core nts-codegen-c nts-core" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /cargo exited 7/);
  assert.deepEqual(called, { args: ["test", "--profile", "nts-dev", "--no-fail-fast", "--message-format=json", "--doc", "-p", "nts-core", "-p", "nts-codegen-c"], checkers: "1",incremental:"1" });
});

test("doc tests share the fixed profile and refuse a conflicting selector", () => {
  const { called } = doctests({ NTS_DOCTEST_CRATES: "nts-core", NTS_TEST_PROFILE: "nts-dev" });
  assert.deepEqual(called, { args: ["test", "--profile", "nts-dev", "--no-fail-fast", "--message-format=json", "--doc", "-p", "nts-core"], checkers: "1",incremental:"1" });
  const bad = doctests({ NTS_TEST_PROFILE: "--release" });
  assert.notEqual(bad.run.status, 0);
  assert.match(bad.run.stderr, /NTS_TEST_PROFILE must be nts-dev/);
  assert.equal(bad.called, null, "cargo is never called with a profile that is not a name");
});
