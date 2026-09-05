'use strict';

// Statically representable behavior from Node v24.20.0
// `parallel/test-blob-file-backed.js`. The final upstream assertion requires a
// structured-clone hook on a host-backed exotic Blob, which is a Section 13
// object-model non-goal; every ordinary file-backed behavior remains here.

const common = require('../common');
const assert = require('assert');
const { Blob, resolveObjectURL } = require('buffer');
const {
  existsSync,
  openAsBlob,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} = require('fs');
const tmpdir = require('../common/tmpdir');
const { URL } = require('url');

tmpdir.refresh();

const mainPath = tmpdir.resolve('file-backed-main.txt');
const slicePath = tmpdir.resolve('file-backed-slice.txt');
const streamPath = tmpdir.resolve('file-backed-stream.txt');
const emptyPath = tmpdir.resolve('file-backed-empty.txt');
const lazyPath = tmpdir.resolve('file-backed-lazy.txt');
const bytePath = tmpdir.resolve('file-backed-byte-path.txt');
const sparsePath = tmpdir.resolve('file-backed-sparse.txt');
const secondOnlyPath = tmpdir.resolve('file-backed-second-only.txt');
const data = `${'a'.repeat(1000)}${'b'.repeat(2000)}`;

for (const [path, contents] of [
  [mainPath, data],
  [slicePath, data],
  [streamPath, data.repeat(100)],
  [emptyPath, ''],
  [lazyPath, 'lazy'],
  [bytePath, 'bytes'],
  [sparsePath, ''],
  [secondOnlyPath, 'aaaa'],
]) {
  writeFileSync(path, contents);
}

async function streamText(blob) {
  const decoder = new TextDecoder();
  const reader = blob.stream().getReader();
  let result = '';
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    result += decoder.decode(item.value, { stream: true });
  }
  return result + decoder.decode();
}

(async () => {
  try {
    const blob = await openAsBlob(mainPath, { type: 'TEXT/PLAIN' });
    assert.strictEqual(blob.size, data.length);
    assert.strictEqual(blob.type, 'TEXT/PLAIN');
    assert.strictEqual(await blob.text(), data);
    assert.strictEqual(new TextDecoder().decode(await blob.arrayBuffer()), data);
    assert.strictEqual(new TextDecoder().decode(await blob.bytes()), data);
    assert.strictEqual(await streamText(blob), data);
    assert.strictEqual(await blob.text(), data);

    const objectUrl = URL.createObjectURL(blob);
    const resolved = resolveObjectURL(objectUrl);
    assert.notStrictEqual(resolved, blob);
    assert.strictEqual(resolved.type, 'TEXT/PLAIN');
    assert.strictEqual(await resolved.text(), data);
    URL.revokeObjectURL(objectUrl);

    const combined = new Blob(['hello', blob, 'world']);
    assert.strictEqual(await combined.text(), `hello${data}world`);

    const sliced = (await openAsBlob(slicePath)).slice(995, 1005);
    assert.strictEqual(sliced.size, 10);
    assert.strictEqual(await sliced.text(), data.slice(995, 1005));
    assert.strictEqual(await streamText(sliced), data.slice(995, 1005));
    assert.strictEqual(await sliced.slice().text(), data.slice(995, 1005));
    assert.strictEqual(
      await (await openAsBlob(slicePath)).slice(995).slice(0, 10).text(),
      data.slice(995, 1005),
    );
    assert.strictEqual(
      await (await openAsBlob(slicePath)).slice(0, 1005).slice(995).text(),
      data.slice(995, 1005),
    );

    const stale = await openAsBlob(mainPath);
    writeFileSync(mainPath, `${data}changed`);
    await assert.rejects(stale.text(), {
      name: 'NotReadableError',
      message: 'The blob could not be read',
    });

    const cancelledReader = (await openAsBlob(streamPath)).stream().getReader();
    assert.strictEqual((await cancelledReader.read()).done, false);
    await cancelledReader.cancel('finished');
    await cancelledReader.closed;

    const streamed = await openAsBlob(streamPath);
    const reader = streamed.stream().getReader();
    const first = await reader.read();
    assert.strictEqual(first.done, false);
    assert.strictEqual(first.value.byteLength, 65_536);
    writeFileSync(streamPath, 'changed');
    await assert.rejects(reader.read(), {
      name: 'NotReadableError',
      message: 'The blob could not be read',
    });

    const empty = await openAsBlob(emptyPath);
    assert.strictEqual(empty.size, 0);
    assert.strictEqual(await empty.text(), '');
    writeFileSync(emptyPath, 'changed');
    await assert.rejects(empty.arrayBuffer(), { name: 'NotReadableError' });

    const lazy = await openAsBlob(lazyPath);
    const lazyReader = lazy.stream().getReader();
    unlinkSync(lazyPath);
    await assert.rejects(lazyReader.read(), { name: 'NotReadableError' });

    const mutablePath = Buffer.from(bytePath);
    const bytePathBlobPromise = openAsBlob(mutablePath);
    mutablePath.fill(120);
    const bytePathBlob = await bytePathBlobPromise;
    assert.strictEqual(await bytePathBlob.text(), 'bytes');

    assert.strictEqual((await openAsBlob(bytePath, { type: false })).type, '');
    assert.strictEqual((await openAsBlob(bytePath, { type: 0 })).type, '');
    assert.strictEqual((await openAsBlob(bytePath, { type: null })).type, '');
    assert.strictEqual((await openAsBlob(bytePath, { type: 'A\x01B' })).type, 'A\x01B');
    assert.strictEqual((await openAsBlob(new URL(`file://${bytePath}`))).size, 5);
    assert.strictEqual((await openAsBlob(bytePath, new Date())).type, '');

    truncateSync(sparsePath, 2 ** 32 + 123);
    assert.strictEqual((await openAsBlob(sparsePath)).size, 123);

    // Pinned Node compares size and only `st_mtim.tv_nsec`, not the seconds
    // component or ctime. Preserve that observable native behavior exactly.
    utimesSync(secondOnlyPath, 1_700_000_000, 1_700_000_000);
    const secondOnly = await openAsBlob(secondOnlyPath);
    writeFileSync(secondOnlyPath, 'bbbb');
    utimesSync(secondOnlyPath, 1_700_000_001, 1_700_000_001);
    assert.strictEqual(await secondOnly.text(), 'bbbb');

    assert.throws(() => openAsBlob(bytePath, null), {
      code: 'ERR_INVALID_ARG_TYPE',
    });
    assert.throws(() => openAsBlob(bytePath, { type: {} }), {
      code: 'ERR_INVALID_ARG_TYPE',
    });
    let missingError;
    try {
      openAsBlob(`${bytePath}.missing`);
    } catch (error) {
      missingError = error;
    }
    assert(missingError instanceof TypeError);
    assert.strictEqual(missingError.name, 'TypeError');
    assert.strictEqual(missingError.code, 'ERR_INVALID_ARG_VALUE');
    assert.strictEqual(missingError.message, 'Unable to open file as blob');
    assert.strictEqual(String(missingError), 'TypeError: Unable to open file as blob');
  } finally {
    for (const path of [
      mainPath,
      slicePath,
      streamPath,
      emptyPath,
      lazyPath,
      bytePath,
      sparsePath,
      secondOnlyPath,
    ]) {
      if (existsSync(path)) unlinkSync(path);
    }
  }
})().then(common.mustCall());
