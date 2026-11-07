import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COMPILE_KEY_INPUTS, compileKey } from "./compile-producer.ts";
import { testScratch } from "../gate/test-scratch.ts";

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
