// The process-local portion of pinned Node
// test/parallel/test-process-finalization.mjs. Its Worker cases require one
// isolated runtime per Node Environment; these five upstream fixtures retain
// exit, beforeExit, garbage-collection cleanup, and explicit unregistering.
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fixtures = require('../../../../third_party/node/test/common/fixtures');

assert.throws(
  () => process.finalization.register(undefined),
  { code: 'ERR_INVALID_ARG_TYPE' },
);
assert.throws(
  () => process.finalization.registerBeforeExit(undefined),
  { code: 'ERR_INVALID_ARG_TYPE' },
);

for (const file of [
  'before-exit.mjs',
  'close.mjs',
  'finalization-cleanup.mjs',
  'gc-not-close.mjs',
  'unregister.mjs',
]) {
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', fixtures.path('process', file)],
    { encoding: 'utf8' },
  );
  assert.strictEqual(child.status, 0, child.stderr);
  assert.strictEqual(child.signal, null);
}
