'use strict';

// Supported subset of upstream test-process-env.js and
// test-process-load-env-file.js. Live exotic property mutation is excluded;
// initial snapshot reads and the explicit loadEnvFile refresh are supported.
const assert = require('assert');
const fixtures = require('../../test/common/fixtures');

assert(Object.keys(process.env).length > 0);
assert.strictEqual(typeof process.env.PATH, 'string');

const valid = fixtures.path('dotenv/valid.env');
process.loadEnvFile(valid);
assert.strictEqual(process.env.BASIC, 'basic');
assert.strictEqual(process.env.AFTER_LINE, 'after_line');

const missing = fixtures.path('dotenv/does-not-exist.env');
assert.throws(
  () => process.loadEnvFile(missing),
  { code: 'ENOENT', syscall: 'open', path: missing },
);
