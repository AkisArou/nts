// Applicable promise subsets of upstream
// `test/parallel/test-fs-write-file-flush.js` and
// `test/parallel/test-fs-append-file-flush.js`. The omitted sync/callback
// assertions replace mutable CommonJS fsync exports with node:test spies.
'use strict';

const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tmpdir = require('../common/tmpdir');

tmpdir.refresh();
let nextFile = 0;

function target(operation, value) {
  return path.join(tmpdir.path, `${operation}-${String(value)}-${nextFile++}`);
}

(async () => {
  const invalidFlushValues = ['true', '', 0, 1, [], {}, Symbol()];
  for (const flush of invalidFlushValues) {
    await assert.rejects(
      fs.promises.writeFile(target('write-invalid', flush), 'foo', { flush }),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
    await assert.rejects(
      fs.promises.appendFile(target('append-invalid', flush), 'foo', { flush }),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }

  for (const flush of [undefined, null, false, true]) {
    const writePath = target('write', flush);
    await fs.promises.writeFile(writePath, 'foo', { flush });
    assert.strictEqual(await fs.promises.readFile(writePath, 'utf8'), 'foo');

    const appendPath = target('append', flush);
    await fs.promises.appendFile(appendPath, 'foo', { flush });
    assert.strictEqual(await fs.promises.readFile(appendPath, 'utf8'), 'foo');
  }
})().then(common.mustCall());
