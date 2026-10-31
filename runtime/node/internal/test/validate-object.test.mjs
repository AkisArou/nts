// Parity with pinned Node `lib/internal/validators.js:234-282`.
// Run: node --expose-internals --test runtime/node/internal/test/validate-object.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as port from "../validators.ts";

const node = createRequire(import.meta.url)("internal/validators");
const flags = Object.keys(node).filter((name) => name.startsWith("kValidateObject")).sort();
const values = [
  ["undefined", undefined], ["null", null], ["zero", 0], ["NaN", NaN],
  ["boolean", false], ["string", "value"], ["bigint", 1n], ["symbol", Symbol("value")],
  ["array", []], ["object", {}], ["null-prototype object", Object.create(null)],
  // Function-name reflection is outside the static profile; anonymous values
  // still compare the full rejection diagnostic for the function branch.
  ["anonymous function", function() {}], ["anonymous class", class {}],
  ["date", new Date(0)], ["typed array", new Uint8Array(0)],
];

function observe(fn, value, options, omitted = false) {
  try {
    return { returned: omitted ? fn(value, "options.value") : fn(value, "options.value", options) };
  } catch (error) {
    return { name: error.name, code: error.code, message: error.message };
  }
}

function compare(options, omitted = false) {
  for (const [label, value] of values) {
    assert.deepEqual(
      observe(port.validateObject, value, options, omitted),
      observe(node.validateObject, value, options, omitted),
      `${label}, options ${omitted ? "omitted" : String(options)}`,
    );
  }
}

test("the oracle is the repository's pinned Node binary", () => {
  const pin = /^nodejs\s+(\S+)/m.exec(readFileSync(new URL("../../../../.tool-versions", import.meta.url), "utf8"));
  assert.ok(pin, "the Node pin must exist");
  assert.equal(process.versions.node, pin[1]);
});

test("all upstream object flags and aliases are exported with their exact values", () => {
  assert.deepEqual(Object.keys(port).filter((name) => name.startsWith("kValidateObject")).sort(), flags);
  for (const name of flags) assert.equal(port[name], node[name], name);
});

test("the omitted and undefined flag preserve the default contract", () => {
  compare(undefined, true);
  compare(undefined);
});

for (const name of flags) {
  test(`${name} preserves acceptance, error class, code and message`, () => compare(node[name]));
}

test("every bit combination and unrelated bits follow the upstream contract", () => {
  for (const options of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1, NaN, Infinity]) compare(options);
});
