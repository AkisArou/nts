"use strict";

// Supported default/string-label behavior from pinned upstream
// `parallel/test-console-count.js`. Its object and Symbol labels require the
// §13 ToPrimitive/prototype protocols and are deliberately left in the
// auditable N/A fixture rather than implemented by this typed string API.
require("../common");

const assert = require("node:assert");

const originalWrite = process.stdout.write;
let output = "";
process.stdout.write = (text) => {
  output = text;
};

console.count();
assert.strictEqual(output, "default: 1\n");

console.count("default");
assert.strictEqual(output, "default: 2\n");

console.count("a");
assert.strictEqual(output, "a: 1\n");

console.count("b");
assert.strictEqual(output, "b: 1\n");

console.count("a");
assert.strictEqual(output, "a: 2\n");

console.count();
assert.strictEqual(output, "default: 3\n");

console.count("null");
assert.strictEqual(output, "null: 1\n");

console.countReset();
console.count();
assert.strictEqual(output, "default: 1\n");

console.countReset("a");
console.count("a");
assert.strictEqual(output, "a: 1\n");

// Resetting `a` does not reset the default counter.
console.count();
assert.strictEqual(output, "default: 2\n");

process.stdout.write = originalWrite;
