// Ordinary `{ path, remove }` portions of upstream
// `test-fs-mkdtempDisposableSync.js` and
// `test-fs-promises-mkdtempDisposable.js`. Runtime Symbol disposal hooks are
// intentionally omitted from the Native TypeScript profile.
'use strict';

const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tmpdir = require('../common/tmpdir');

tmpdir.refresh();

{
  const result = fs.mkdtempDisposableSync(tmpdir.resolve('sync.'));
  assert.strictEqual(path.basename(result.path).length, 'sync.XXXXXX'.length);
  assert.strictEqual(fs.existsSync(result.path), true);
  result.remove();
  assert.strictEqual(fs.existsSync(result.path), false);
  result.remove();
}

{
  const originalCwd = process.cwd();
  process.chdir(tmpdir.path);
  const first = fs.mkdtempDisposableSync('first.');
  const second = fs.mkdtempDisposableSync('second.');
  const firstPath = path.join(tmpdir.path, first.path);
  const secondPath = path.join(tmpdir.path, second.path);
  process.chdir(firstPath);
  second.remove();
  assert.strictEqual(fs.existsSync(secondPath), false);
  process.chdir(tmpdir.path);
  first.remove();
  assert.strictEqual(fs.existsSync(firstPath), false);
  process.chdir(originalCwd);
}

(async () => {
  const result = await fs.promises.mkdtempDisposable(tmpdir.resolve('promise.'));
  assert.strictEqual(path.basename(result.path).length, 'promise.XXXXXX'.length);
  assert.strictEqual(fs.existsSync(result.path), true);
  await result.remove();
  assert.strictEqual(fs.existsSync(result.path), false);
  await result.remove();

  const originalCwd = process.cwd();
  process.chdir(tmpdir.path);
  const first = await fs.promises.mkdtempDisposable('async-first.');
  const second = await fs.promises.mkdtempDisposable('async-second.');
  const firstPath = path.join(tmpdir.path, first.path);
  const secondPath = path.join(tmpdir.path, second.path);
  process.chdir(firstPath);
  await second.remove();
  assert.strictEqual(fs.existsSync(secondPath), false);
  process.chdir(tmpdir.path);
  await first.remove();
  assert.strictEqual(fs.existsSync(firstPath), false);
  process.chdir(originalCwd);
})().then(common.mustCall());
