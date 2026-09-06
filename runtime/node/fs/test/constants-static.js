// Retained from pinned upstream `parallel/test-fs-constants.js`.
// The omitted assertions inspect prototypes and writable property descriptors.
'use strict';

const assert = require('assert');
const { constants } = require('fs');

for (const name of [
  'O_DIRECT',
  'O_DIRECTORY',
  'O_DSYNC',
  'O_NOATIME',
  'O_NOCTTY',
  'O_NOFOLLOW',
  'O_NONBLOCK',
  'UV_FS_O_FILEMAP',
]) {
  assert.strictEqual(typeof constants[name], 'number', name);
}
