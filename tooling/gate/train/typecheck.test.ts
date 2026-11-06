import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnTest } from "../test-wait.ts";

for (const relative of ["./tsconfig.json", "../../lanes/train-attribution/tsconfig.json"]) test(`the pinned checker accepts ${relative} with zero diagnostics`, () => {
  const checker = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
  const project = fileURLToPath(new URL(relative, import.meta.url));
  const result = spawnTest(process.execPath, [checker, "--project", project], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});
