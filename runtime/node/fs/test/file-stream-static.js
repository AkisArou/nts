// Ordinary typed portions of the upstream fs stream tests whose remaining
// assertions require mutable CommonJS exports, runtime prototype mutation, or
// prototype-receiver inspection. Error injection uses Node's supported
// `options.fs` contract instead of monkey-patching the module namespace.
'use strict';

const assert = require('assert');
const common = require('../common');
const fs = require('fs');
const path = require('path');
const tmpdir = require('../common/tmpdir');

tmpdir.refresh();

const target = (name) => path.join(tmpdir.path, name);

function waitFor(stream, event) {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once(event, resolve);
  });
}

async function autoCloseOwnership() {
  const file = target('auto-close.txt');
  const first = fs.createWriteStream(file, { flags: 'w+', autoClose: false });
  const firstFinished = waitFor(first, 'finish');
  first.end('Test1');
  await firstFinished;
  assert.strictEqual(first.closed, false);
  assert.strictEqual(typeof first.fd, 'number');

  const second = fs.createWriteStream(null, { fd: first.fd, start: 0 });
  const secondClosed = waitFor(second, 'close');
  second.end('Test2');
  await secondClosed;
  assert.strictEqual(second.fd, null);
  assert.strictEqual(second.closed, true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'Test2');

  const third = fs.createWriteStream(file, { autoClose: true });
  const thirdClosed = waitFor(third, 'close');
  third.end('Test3');
  await thirdClosed;
  assert.strictEqual(third.fd, null);
  assert.strictEqual(third.closed, true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'Test3');
}

async function writeFailure() {
  const failure = new Error('write failed');
  let writes = 0;
  let closes = 0;
  const operations = {
    open: fs.open,
    write(fd, buffer, offset, length, position, callback) {
      writes++;
      if (writes === 1) {
        fs.write(fd, buffer, offset, length, position, callback);
      } else {
        process.nextTick(callback, failure);
      }
    },
    close(fd, callback) {
      closes++;
      fs.close(fd, callback);
    },
  };
  const stream = fs.createWriteStream(target('write-error.txt'), {
    highWaterMark: 10,
    fs: operations,
  });
  const failed = new Promise((resolve) => stream.once('error', resolve));
  const closed = new Promise((resolve) => stream.once('close', resolve));

  stream.write(Buffer.alloc(256), (error) => {
    assert.ifError(error);
    stream.write(Buffer.alloc(256), (secondError) => {
      assert.strictEqual(secondError, failure);
    });
  });

  assert.strictEqual(await failed, failure);
  await closed;
  assert.strictEqual(stream.fd, null);
  assert.strictEqual(writes, 2);
  assert.strictEqual(closes, 1);
}

async function readFailure() {
  const file = target('read-error.txt');
  fs.writeFileSync(file, 'ab');
  const failure = new Error('read failed');
  let reads = 0;
  let closes = 0;
  const operations = {
    open: fs.open,
    read(fd, buffer, offset, length, position, callback) {
      reads++;
      if (reads === 1) {
        fs.read(fd, buffer, offset, length, position, callback);
      } else {
        process.nextTick(callback, failure);
      }
    },
    close(fd, callback) {
      closes++;
      fs.close(fd, callback);
    },
  };
  const stream = fs.createReadStream(file, { highWaterMark: 1, fs: operations });
  let chunks = 0;
  stream.on('data', () => chunks++);
  const failed = new Promise((resolve) => stream.once('error', resolve));
  const closed = new Promise((resolve) => stream.once('close', resolve));

  assert.strictEqual(await failed, failure);
  await closed;
  assert.strictEqual(stream.fd, null);
  assert.strictEqual(chunks, 1);
  assert.strictEqual(reads, 2);
  assert.strictEqual(closes, 1);
}

function flushingOperations(onSync) {
  return {
    open: fs.open,
    write: fs.write,
    writev: fs.writev,
    close: fs.close,
    fsync(fd, callback) {
      onSync();
      fs.fsync(fd, callback);
    },
  };
}

async function flushing() {
  for (const invalid of ['true', '', 0, 1, [], {}]) {
    assert.throws(
      () => fs.createWriteStream(target('invalid-flush.txt'), { flush: invalid }),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }

  let syncs = 0;
  const flushed = target('flushed.txt');
  const stream = fs.createWriteStream(flushed, {
    flush: true,
    fs: flushingOperations(() => syncs++),
  });
  const closed = waitFor(stream, 'close');
  stream.end('flushed');
  await closed;
  assert.strictEqual(syncs, 1);
  assert.strictEqual(fs.readFileSync(flushed, 'utf8'), 'flushed');

  for (const flush of [undefined, null, false]) {
    const file = target(`not-flushed-${String(flush)}.txt`);
    const notFlushed = fs.createWriteStream(file, {
      flush,
      fs: flushingOperations(() => syncs++),
    });
    const notFlushedClosed = waitFor(notFlushed, 'close');
    notFlushed.end('ordinary');
    await notFlushedClosed;
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'ordinary');
  }
  assert.strictEqual(syncs, 1);

  const handleFile = target('handle-flush.txt');
  const handle = await fs.promises.open(handleFile, 'w');
  const handleStream = handle.createWriteStream({ flush: true });
  const handleClosed = waitFor(handleStream, 'close');
  handleStream.end('handle');
  await handleClosed;
  assert.strictEqual(fs.readFileSync(handleFile, 'utf8'), 'handle');
}

async function validationAndIdleDrain() {
  const file = target('validation.txt');
  const invalid = fs.createWriteStream(file);
  invalid.on('error', () => {});
  assert.throws(() => invalid.write(42), {
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
  });
  const invalidClosed = waitFor(invalid, 'close');
  invalid.destroy();
  await invalidClosed;

  const idle = fs.createWriteStream(file);
  idle.on('drain', () => assert.fail('drain emitted without a write'));
  const idleClosed = waitFor(idle, 'close');
  idle.destroy();
  await idleClosed;
}

async function deprecatedOpenNoops() {
  common.expectWarning('DeprecationWarning', [
    ['ReadStream.prototype.open() is deprecated', 'DEP0135'],
    ['WriteStream.prototype.open() is deprecated', 'DEP0135'],
  ]);

  const file = target('deprecated-open.txt');
  fs.writeFileSync(file, 'data');
  const readable = fs.createReadStream(file);
  await waitFor(readable, 'open');
  readable.open();
  const readableClosed = waitFor(readable, 'close');
  readable.destroy();
  await readableClosed;

  const writable = fs.createWriteStream(file);
  await waitFor(writable, 'open');
  writable.open();
  const writableClosed = waitFor(writable, 'close');
  writable.destroy();
  await writableClosed;
}

(async () => {
  await autoCloseOwnership();
  await writeFailure();
  await readFailure();
  await flushing();
  await validationAndIdleDrain();
  await deprecatedOpenNoops();
})().catch((error) => {
  setImmediate(() => {
    throw error;
  });
});
