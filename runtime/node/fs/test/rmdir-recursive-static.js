// Applicable public-API portion of upstream
// `test/parallel/test-fs-rmdir-recursive.js`. The omitted final block imports
// Node's private `internal/fs/utils` validator, which is not part of node:fs.
'use strict';

const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tmpdir = require('../common/tmpdir');

common.expectWarning(
  'DeprecationWarning',
  'In future versions of Node.js, fs.rmdir(path, { recursive: true }) ' +
    'will be removed. Use fs.rm(path, { recursive: true }) instead',
  'DEP0147',
);

tmpdir.refresh();

function makeTree(name) {
  const root = tmpdir.resolve(name);
  const child = path.join(root, 'child');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(root, 'root.txt'), 'root');
  fs.writeFileSync(path.join(child, 'child.txt'), 'child');
  fs.symlinkSync('child.txt', path.join(child, 'link'), 'file');
  return root;
}

{
  const root = makeTree('sync');
  assert.throws(() => fs.rmdirSync(root), { syscall: 'rmdir' });
  assert.throws(() => fs.rmdirSync(root, { recursive: false }), {
    syscall: 'rmdir',
  });
  fs.rmdirSync(root, { recursive: true });
  assert.strictEqual(fs.existsSync(root), false);
  assert.throws(() => fs.rmdirSync(root, { recursive: true }), {
    code: 'ENOENT',
  });
}

{
  const root = makeTree('callback');
  fs.rmdir(root, { recursive: true }, common.mustSucceed(() => {
    assert.strictEqual(fs.existsSync(root), false);
    fs.rmdir(root, { recursive: true }, common.mustCall((error) => {
      assert.strictEqual(error.code, 'ENOENT');
    }));
  }));
}

(async () => {
  const root = makeTree('promise');
  await fs.promises.rmdir(root, { recursive: true });
  assert.strictEqual(fs.existsSync(root), false);
  await assert.rejects(fs.promises.rmdir(root, { recursive: true }), {
    code: 'ENOENT',
  });
})().then(common.mustCall());
