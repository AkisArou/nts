'use strict';

// POSIX-supported extraction of upstream test-process-getgroups.js. The
// upstream file makes a missing getgroups() a success, which means an empty
// sabotaged module passes without testing anything. Keep its external `id -G`
// oracle and require the API that this Linux profile intentionally exposes.
const common = require('../common');
const assert = require('assert');
const exec = require('child_process').exec;

assert.strictEqual(typeof process.getgroups, 'function');
const groups = unique(process.getgroups());
assert(Array.isArray(groups));
assert(groups.length > 0);

exec('id -G', common.mustSucceed((stdout) => {
  const realGroups = unique(stdout.match(/\d+/g).map(Number));
  assert.deepStrictEqual(groups, realGroups);
  check(groups, realGroups);
  check(realGroups, groups);
}));

function check(a, b) {
  for (let i = 0; i < a.length; ++i) assert(b.includes(a[i]));
}

function unique(values) {
  return [...new Set(values)].sort();
}
