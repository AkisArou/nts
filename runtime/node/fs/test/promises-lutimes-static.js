// Retained from pinned upstream `parallel/test-fs-promises.js`.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nts-fsp-lutimes-'));
const target = path.join(root, 'target');
const link = path.join(root, 'link');
fs.writeFileSync(target, 'target');
fs.symlinkSync(target, link);

const atime = new Date('2020-01-02T03:04:05.000Z');
const mtime = new Date('2021-02-03T04:05:06.000Z');
const targetBefore = fs.statSync(target);

(async () => {
  await fs.promises.lutimes(link, atime, mtime);

  const linkAfter = fs.lstatSync(link);
  assert.strictEqual(linkAfter.atimeMs, atime.getTime());
  assert.strictEqual(linkAfter.mtimeMs, mtime.getTime());

  const targetAfter = fs.statSync(target);
  assert.strictEqual(targetAfter.atimeMs, targetBefore.atimeMs);
  assert.strictEqual(targetAfter.mtimeMs, targetBefore.mtimeMs);
})().finally(() => fs.rmSync(root, { force: true, recursive: true }));
