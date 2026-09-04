'use strict';

// Supported subset of upstream test-process-env-allowed-flags.js. The source
// file's Object.freeze and direct Set.prototype mutation assertions are §13
// non-goals; membership, canonical iteration and public no-op mutators are not.
const assert = require('assert');

const flags = process.allowedNodeEnvironmentFlags;
for (const flag of [
  '--perf_basic_prof',
  '--perf-basic-prof',
  'perf-basic-prof',
  '-r',
  'r',
  '--stack-trace-limit=100',
]) {
  assert.strictEqual(flags.has(flag), true, flag);
}
for (const flag of ['--r', '-R', '---inspect-brk', '--cheeseburgers']) {
  assert.strictEqual(flags.has(flag), false, flag);
}

const size = flags.size;
assert(size > 0);
for (const flag of flags) assert.match(flag, /^--?[a-zA-Z0-9._-]+$/);
flags.add('not-a-real-node-option');
flags.delete('-r');
flags.clear();
assert.strictEqual(flags.size, size);
assert.strictEqual(flags.has('not-a-real-node-option'), false);
assert.strictEqual(flags.has('-r'), true);
