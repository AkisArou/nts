// Applicable subset of upstream `test/parallel/test-fs-opendir.js` and
// `test/sequential/test-fs-opendir-recursive.js`. The omitted blocks require
// runtime Symbol.asyncIterator hooks or constructor.prototype inspection.
'use strict';

const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tmpdir = require('../common/tmpdir');

tmpdir.refresh();
const root = tmpdir.path;
const files = ['alpha', 'beta', 'gamma'];
for (const name of files) fs.writeFileSync(path.join(root, name), '');
fs.mkdirSync(path.join(root, 'nested'));
fs.writeFileSync(path.join(root, 'nested', 'child'), '');

function collectSync(directory) {
  const entries = [];
  let entry = directory.readSync();
  while (entry !== null) {
    assert(entry instanceof fs.Dirent);
    entries.push(path.relative(root, path.join(entry.parentPath, entry.name)));
    entry = directory.readSync();
  }
  return entries.sort();
}

{
  const directory = fs.opendirSync(root, { bufferSize: 1 });
  assert(directory instanceof fs.Dir);
  assert.strictEqual(directory.path, root);
  assert.deepStrictEqual(collectSync(directory), [...files, 'nested'].sort());
  directory.closeSync();
  assert.throws(() => directory.readSync(), { code: 'ERR_DIR_CLOSED' });
  assert.throws(() => directory.closeSync(), { code: 'ERR_DIR_CLOSED' });
}

{
  const directory = fs.opendirSync(root, { recursive: true, bufferSize: 1 });
  assert.deepStrictEqual(
    collectSync(directory),
    [...files, 'nested', path.join('nested', 'child')].sort(),
  );
  directory.closeSync();
}

for (const bufferSize of [-1, 0, 0.5, Infinity, NaN]) {
  assert.throws(() => fs.opendirSync(root, { bufferSize }), {
    code: 'ERR_OUT_OF_RANGE',
  });
}
for (const bufferSize of ['', null]) {
  assert.throws(() => fs.opendirSync(root, { bufferSize }), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
}

assert.throws(() => fs.opendir(__filename), { code: 'ERR_INVALID_ARG_TYPE' });
assert.throws(() => fs.opendirSync(__filename), { code: 'ENOTDIR' });
assert.throws(() => new fs.Dir(), { code: 'ERR_MISSING_ARGS' });

fs.opendir(root, common.mustSucceed((directory) => {
  let synchronous = true;
  directory.read(common.mustSucceed((entry) => {
    assert.strictEqual(synchronous, false);
    assert(entry instanceof fs.Dirent);
    directory.close(common.mustSucceed());
  }));
  synchronous = false;
}));

(async () => {
  const directory = await fs.promises.opendir(root);
  const firstRead = directory.read();
  assert.throws(() => directory.readSync(), {
    code: 'ERR_DIR_CONCURRENT_OPERATION',
  });
  assert.throws(() => directory.closeSync(), {
    code: 'ERR_DIR_CONCURRENT_OPERATION',
  });
  assert(await firstRead instanceof fs.Dirent);

  const secondRead = directory.read();
  const thirdRead = directory.read();
  assert(await secondRead instanceof fs.Dirent);
  assert(await thirdRead instanceof fs.Dirent);
  await directory.close();
  await assert.rejects(directory.read(), { code: 'ERR_DIR_CLOSED' });
  await assert.rejects(directory.close(), { code: 'ERR_DIR_CLOSED' });

  const recursive = await fs.promises.opendir(root, {
    recursive: true,
    bufferSize: 1,
  });
  const entries = [];
  let entry = await recursive.read();
  while (entry !== null) {
    entries.push(path.relative(root, path.join(entry.parentPath, entry.name)));
    entry = await recursive.read();
  }
  assert.deepStrictEqual(
    entries.sort(),
    [...files, 'nested', path.join('nested', 'child')].sort(),
  );
  await recursive.close();
})().then(common.mustCall());
