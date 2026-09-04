'use strict';

// Supported subset of upstream test-process-ref-unref.js. Runtime dispatch
// through Symbol.for('nodejs.ref/unref') is excluded; statically named legacy
// ref()/unref() methods remain part of the profile.
const assert = require('assert');

const resource = {
  refCalls: 0,
  unrefCalls: 0,
  ref() { this.refCalls++; },
  unref() { this.unrefCalls++; },
};

process.ref(resource);
process.unref(resource);
process.ref(null);
process.unref(undefined);
assert.strictEqual(resource.refCalls, 1);
assert.strictEqual(resource.unrefCalls, 1);
