import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnTest } from "../../gate/test-wait.ts";

test("the shared Node cache retention has zero pinned checker diagnostics", () => {
  const checker = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
  const project = fileURLToPath(new URL("./tsconfig.json", import.meta.url));
  const result = spawnTest(process.execPath, [checker, "--project", project], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.signal, null); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});
