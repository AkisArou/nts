// Direct coverage for the behavior exercised only in child processes by
// upstream `test/parallel/test-fs-readfile-eof.js`.
'use strict';

const common = require('../common');
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const tmpdir = require('../common/tmpdir');

tmpdir.refresh();

const expected = 'Hello\nWorld\n';

function makeFifo(name) {
  const fifo = path.join(tmpdir.path, name);
  childProcess.execFileSync('mkfifo', [fifo]);
  return fifo;
}

function startWriter(fifo) {
  const writer = childProcess.spawn(
    'sh',
    [
      '-c',
      'exec > "$1"; printf "Hello\\n"; sleep 0.05; printf "World\\n"',
      'writer',
      fifo,
    ],
  );
  writer.on('exit', common.mustCall((code) => assert.strictEqual(code, 0)));
}

function startFileWriter(source, fifo) {
  const writer = childProcess.spawn(
    'sh',
    ['-c', 'cat "$1" > "$2"', 'writer', source, fifo],
  );
  writer.on('exit', common.mustCall((code) => assert.strictEqual(code, 0)));
}

{
  const fifo = makeFifo('callback');
  startWriter(fifo);
  fs.readFile(fifo, 'utf8', common.mustSucceed((contents) => {
    assert.strictEqual(contents, expected);
  }));
}

(async () => {
  const fifo = makeFifo('promise');
  startWriter(fifo);
  const contents = await fs.promises.readFile(fifo);
  assert.strictEqual(contents.toString(), expected);
})().then(common.mustCall());

const largeExpected = 'a'.repeat(999_999);
const largeSource = path.join(tmpdir.path, 'large-source');
fs.writeFileSync(largeSource, largeExpected);

{
  const fifo = makeFifo('callback-large');
  startFileWriter(largeSource, fifo);
  fs.readFile(fifo, 'utf8', common.mustSucceed((contents) => {
    assert.strictEqual(contents, largeExpected);
  }));
}

{
  const fifo = makeFifo('sync-large');
  startFileWriter(largeSource, fifo);
  assert.strictEqual(fs.readFileSync(fifo, 'utf8'), largeExpected);
}
