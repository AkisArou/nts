'use strict';

// Supported subsets of upstream test-process-hrtime.js and
// test-process-versions.js. Their eval/V8 intrinsics and property-descriptor
// assertions are excluded; ordinary timing and version values are supported.
const assert = require('assert');

const start = process.hrtime();
assert(Array.isArray(start));
assert.strictEqual(start.length, 2);
assert(Number.isInteger(start[0]));
assert(Number.isInteger(start[1]));
const elapsed = process.hrtime(start);
assert(elapsed[0] >= 0);
assert(elapsed[1] >= 0 && elapsed[1] < 1e9);

for (const key of ['node', 'uv', 'v8', 'modules', 'napi']) {
  assert.strictEqual(typeof process.versions[key], 'string', key);
  assert(process.versions[key].length > 0, key);
}
assert.match(process.versions.node, /^\d+\.\d+\.\d+/);
