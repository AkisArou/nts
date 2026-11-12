import assert from "node:assert/strict";
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COMPILE_KEY_INPUTS, COMPILE_CAPTURE_BYTES, compileEnvironment, compileKey, observeCompile } from "./compile-producer.ts";
import { testScratch } from "../gate/test-scratch.ts";
import { fixtureEnvironment } from "../gate/test-environment.ts";
import { closeMemoryRun } from "../census/worker-memory.ts";

const repository = fileURLToPath(new URL("../../", import.meta.url));
/** What is not compile behaviour: none of these may move a recorded row's key. */
const NOT_THE_PRODUCER = {
  recorder: "tooling/bench/build-records.ts",
  "benchmark comparator": "tooling/bench/outcomes.ts",
  "shared ratchet": "tooling/conformance/outcome-transition.ts",
  "line-record format": "tooling/census/line-record.ts",
  "runtime observation text": "tooling/conformance/observation-text.ts",
  "node oracle": "tooling/differential/record-oracles.ts",
};

test("the compile key moves with the compile producer and nothing else", t => {
  assert.deepEqual([...COMPILE_KEY_INPUTS], ["tooling/bench/compile-producer.ts", "tooling/conformance/compile-diagnostics.ts"]);
  const root = testScratch(t, "compile-key-tree");
  for (const path of [...COMPILE_KEY_INPUTS, ...Object.values(NOT_THE_PRODUCER)]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(repository, path), join(root, path));
  }
  const key = compileKey(root);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(compileKey(repository), key, "the key is the bytes of its inputs, wherever the tree is");
  for (const [role, path] of Object.entries(NOT_THE_PRODUCER)) {
    appendFileSync(join(root, path), "\n// an edit\n");
    assert.equal(compileKey(root), key, `an edit to the ${role} (${path}) leaves the key`);
  }
  for (const path of COMPILE_KEY_INPUTS) {
    const before = readFileSync(join(root, path));
    appendFileSync(join(root, path), "\n// an edit\n");
    assert.notEqual(compileKey(root), key, `an edit to ${path} moves the key`);
    writeFileSync(join(root, path), before);
    assert.equal(compileKey(root), key);
  }
});

test("LLVM artifacts can exceed the diagnostic capture budget; routing the same IR through stdout fails by name", async t => {
  const root = testScratch(t, "llvm-file-artifact"), project = join(root, "tsconfig.json"), output = join(root, "output");
  writeFileSync(project, "{}");
  const compiler = (name: string, stdout: boolean) => {
    const binary = join(root, name);
    writeFileSync(binary, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
const at=args.indexOf('--out'),file=at>=0&&!${stdout};
const fd=file?fs.openSync(path.join(args[at+1],'program.ll'),'w'):1;
const block=Buffer.from(';'+ ' '.repeat((1<<20)-2)+'\\n');
for(let index=0;index<${COMPILE_CAPTURE_BYTES / 2 ** 20 + 1};index++)fs.writeSync(fd,block);
fs.writeSync(fd,'define i32 @control() { ret i32 7 }\\n');
if(file){fs.closeSync(fd);process.stdout.write('artifact written\\n');}
`);
    chmodSync(binary, 0o755); return binary;
  };
  const fileCompiler = compiler("emit-to-file", false), stdoutCompiler = compiler("emit-to-stdout", true);
  const env = compileEnvironment(fixtureEnvironment(t), root, fileCompiler);
  // This is a kernel wiring control of the real capture bridge and clang's
  // artifact input. No elapsed interval decides either verdict.
  try {
    assert.deepEqual(await observeCompile({ backend: "llvm", project, output, binary: fileCompiler, root, env }), { kind: "pass" });
    assert.ok(statSync(join(output, "program.ll")).size > COMPILE_CAPTURE_BYTES);
    await assert.rejects(observeCompile({ backend: "llvm", project, output, binary: stdoutCompiler, root, env }), /stdout.*capture budget/);
  } finally { closeMemoryRun(); }
});
