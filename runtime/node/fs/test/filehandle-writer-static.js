// Ordinary typed portion of upstream
// `test/parallel/test-fs-promises-file-handle-writer.js`. That file also mixes
// in Symbol.dispose/asyncDispose; this focused test keeps every ordinary writer
// state and I/O operation independent of those Native TypeScript non-goals.
// The pull()/stream-iter pipelines run in their own untouched upstream tests.
'use strict';

const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tmpdir = require('../common/tmpdir');

tmpdir.refresh();

const file = (name) => path.join(tmpdir.path, name);

async function basicWrites() {
  const target = file('basic.txt');
  const handle = await fs.promises.open(target, 'w');
  const writer = handle.writer();
  await writer.write(Buffer.from('head-'));
  await writer.writev(['middle-', Buffer.from('tail')]);
  assert.strictEqual(await writer.end(), 16);
  await handle.close();
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'head-middle-tail');
}

async function positionedWrites() {
  const target = file('position.txt');
  fs.writeFileSync(target, '..........');
  const handle = await fs.promises.open(target, 'r+');
  const writer = handle.writer({ start: 2 });
  await writer.write('AA');
  await writer.writev(['B', 'C']);
  await writer.end();
  await handle.close();
  assert.strictEqual(fs.readFileSync(target, 'utf8'), '..AABC....');
}

async function ownershipAndLocking() {
  const target = file('locking.txt');
  const handle = await fs.promises.open(target, 'w');
  const first = handle.writer();
  assert.throws(() => handle.writer(), { code: 'ERR_INVALID_STATE', message: /locked/ });
  await first.write('first');
  const ending = first.end();
  const endingAgain = first.end();
  assert.deepStrictEqual(await Promise.all([ending, endingAgain]), [5, 5]);

  const second = handle.writer();
  await second.write(' second');
  second.fail(new Error('stop'));
  await assert.rejects(second.end(), { message: 'stop' });

  const recovered = handle.writer();
  await recovered.write(' recovered');
  await recovered.end();
  await handle.close();
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'first second recovered');
  assert.throws(() => handle.writer(), { code: 'ERR_INVALID_STATE', message: /closed/ });
}

async function autoClose() {
  const endedPath = file('auto-end.txt');
  const endedHandle = await fs.promises.open(endedPath, 'w');
  const endedWriter = endedHandle.writer({ autoClose: true });
  await endedWriter.write('ended');
  await endedWriter.end();
  await assert.rejects(endedHandle.stat(), { code: 'EBADF' });

  const failedPath = file('auto-fail.txt');
  const failedHandle = await fs.promises.open(failedPath, 'w');
  const failedWriter = failedHandle.writer({ autoClose: true });
  await failedWriter.write('partial');
  failedWriter.fail(new Error('failed'));
  await assert.rejects(failedHandle.stat(), { code: 'EBADF' });
  assert.strictEqual(fs.readFileSync(failedPath, 'utf8'), 'partial');
}

async function closedWriter() {
  const target = file('closed.txt');
  const handle = await fs.promises.open(target, 'w');
  const writer = handle.writer();
  await writer.write('data');
  await writer.end();
  await assert.rejects(writer.write('more'), { code: 'ERR_INVALID_STATE' });
  await assert.rejects(writer.writev(['more']), { code: 'ERR_INVALID_STATE' });
  assert.strictEqual(writer.writeSync('more'), false);
  assert.strictEqual(writer.writevSync(['more']), false);
  assert.strictEqual(writer.endSync(), 4);
  await handle.close();
}

async function abortedOperations() {
  const target = file('aborted.txt');
  const handle = await fs.promises.open(target, 'w');
  const writer = handle.writer();
  const reason = new Error('cancelled');
  const signal = AbortSignal.abort(reason);
  await assert.rejects(writer.write('no', { signal }), (error) => error === reason);
  await assert.rejects(writer.writev(['no'], { signal }), (error) => error === reason);
  await assert.rejects(writer.end({ signal }), (error) => error === reason);
  await writer.write('yes');
  assert.strictEqual(await writer.end(), 3);
  await handle.close();
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'yes');
}

async function synchronousWrites() {
  const target = file('sync.txt');
  const handle = await fs.promises.open(target, 'w');
  const writer = handle.writer();
  assert.strictEqual(writer.writeSync('one-'), true);
  assert.strictEqual(writer.writevSync(['two-', Buffer.from('three')]), true);
  assert.strictEqual(writer.endSync(), 13);
  assert.strictEqual(writer.endSync(), 13);
  await handle.close();
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'one-two-three');

  const autoPath = file('sync-auto.txt');
  const autoHandle = await fs.promises.open(autoPath, 'w');
  const autoWriter = autoHandle.writer({ autoClose: true });
  assert.strictEqual(autoWriter.writeSync('auto'), true);
  assert.strictEqual(autoWriter.endSync(), 4);
  await assert.rejects(autoHandle.stat(), { code: 'EBADF' });
}

async function synchronousFallback() {
  const target = file('fallback.txt');
  const handle = await fs.promises.open(target, 'w');
  const writer = handle.writer();
  assert.strictEqual(writer.writeSync(Buffer.alloc(131073, 0x78)), false);
  assert.strictEqual(writer.writeSync(Buffer.alloc(131072, 0x79)), true);
  const pending = writer.write('async');
  assert.strictEqual(writer.writeSync('blocked'), false);
  assert.strictEqual(writer.endSync(), -1);
  await pending;
  assert.strictEqual(writer.writeSync('sync'), true);
  assert.strictEqual(await writer.end(), 131081);
  await handle.close();
  assert.strictEqual(fs.statSync(target).size, 131081);
}

async function limits() {
  const target = file('limit.txt');
  fs.writeFileSync(target, '...........');
  const handle = await fs.promises.open(target, 'r+');
  const writer = handle.writer({ start: 3, limit: 5 });
  await writer.write('12');
  await assert.rejects(writer.writev(['34', '56']), { code: 'ERR_OUT_OF_RANGE' });
  assert.strictEqual(writer.writevSync(['3', '4']), true);
  assert.strictEqual(writer.writeSync('56'), false);
  assert.strictEqual(writer.writeSync('5'), true);
  assert.strictEqual(writer.endSync(), 5);
  await handle.close();
  assert.strictEqual(fs.readFileSync(target, 'utf8'), '...12345...');
}

async function validation() {
  const target = file('validation.txt');
  const handle = await fs.promises.open(target, 'w');
  assert.throws(() => handle.writer({ autoClose: 'no' }), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => handle.writer({ start: 'a' }), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => handle.writer({ start: -1 }), { code: 'ERR_OUT_OF_RANGE' });
  assert.throws(() => handle.writer({ limit: 1.1 }), { code: 'ERR_OUT_OF_RANGE' });
  assert.throws(() => handle.writer({ limit: -1 }), { code: 'ERR_OUT_OF_RANGE' });
  assert.throws(() => handle.writer({ chunkSize: 0 }), { code: 'ERR_OUT_OF_RANGE' });
  const writer = handle.writer();
  assert.throws(() => writer.write(1), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => writer.writev('no'), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => writer.write('x', 1), { code: 'ERR_INVALID_ARG_TYPE' });
  await writer.end();
  await handle.close();
}

(async () => {
  await basicWrites();
  await positionedWrites();
  await ownershipAndLocking();
  await autoClose();
  await closedWriter();
  await abortedOperations();
  await synchronousWrites();
  await synchronousFallback();
  await limits();
  await validation();
})().then(common.mustCall()).catch((error) => {
  setImmediate(() => {
    throw error;
  });
});
