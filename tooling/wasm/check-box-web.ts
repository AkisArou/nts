import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [artifact, source] = process.argv.slice(2);
const wasm = await import(pathToFileURL(path.join(artifact, "program.mjs")).href);
const js = await import(pathToFileURL(source).href);
const values = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.5, -0.5,
  2 ** 30 - 1, 2 ** 30, 2 ** 30 + 1, -(2 ** 30), -(2 ** 30) - 1,
  2 ** 31 - 1, 2 ** 31, -(2 ** 31), 2 ** 32 - 1, 2 ** 32,
  Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE,
  Number.MAX_SAFE_INTEGER];
const exports = ["numeric", "numericControl", "edge", "edgeControl",
  "escaping", "escapingControl", "mixed", "mixedControl"];
let cases = 0;
for (const name of exports) {
  assert.equal(typeof wasm[name], "function");
  assert.equal(typeof js[name], "function");
  for (const value of values) {
    assert(Object.is(wasm[name](value), js[name](value)), `${name}(${String(value)})`);
    cases++;
  }
}
assert.equal(cases, 192);
process.stdout.write(JSON.stringify({ cases, exports: exports.length }) + "\n");
