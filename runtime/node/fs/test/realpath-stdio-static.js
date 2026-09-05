'use strict';

// Upstream test-fs-realpath-pipe.js performs these calls only in separately
// spawned Node processes, where the in-process module substitution cannot
// follow. Keep the same public behavior direct and sabotage-sensitive.

const common = require('../common');
if (common.isWindows || common.isAIX || common.isIBMi)
  common.skip(`No /dev/stdin on ${process.platform}.`);

const assert = require('assert');
const fs = require('fs');

assert.ok(fs.realpathSync('/dev/stdin'));
fs.realpath('/dev/stdin', common.mustSucceed((resolvedPath) => {
  assert.ok(resolvedPath);
}));
