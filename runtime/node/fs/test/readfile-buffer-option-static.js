'use strict';

// Public cases from Node's test-fs-readfile-buffer-option.js and
// test-fs-promises-readfile-buffer-option.js. Those upstream files also
// replace internalBinding('fs').fstat; /proc supplies a real zero-sized file
// with contents here, so the same overflow path is tested without a mutable
// private binding object.

const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const tmpdir = require('../common/tmpdir');

tmpdir.refresh();

const file = tmpdir.resolve('readfile-buffer-option-static.txt');
const content = Buffer.from('caller-owned read buffer\n'.repeat(128));
fs.writeFileSync(file, content);

function assertDestination(result, destination, sentinel) {
  assert.deepStrictEqual(result, content);
  assert.deepStrictEqual(result, destination.subarray(0, content.length));
  assert(destination.subarray(content.length).every((byte) => byte === sentinel));
}

function readFile(path, options) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

{
  const destination = Buffer.alloc(content.length + 16, 0x78);
  assertDestination(fs.readFileSync(file, { buffer: destination }), destination, 0x78);
}

{
  let requestedSize = -1;
  const destination = Buffer.alloc(content.length + 8, 0x79);
  const result = fs.readFileSync(file, {
    buffer(size) {
      requestedSize = size;
      return destination;
    },
  });
  assert.strictEqual(requestedSize, content.length);
  assertDestination(result, destination, 0x79);
}

{
  const destination = Buffer.alloc(content.length + 8);
  assert.strictEqual(
    fs.readFileSync(file, { buffer: destination, encoding: 'utf8' }),
    content.toString('utf8'),
  );
  assert.deepStrictEqual(destination.subarray(0, content.length), content);
}

assert.throws(
  () => fs.readFileSync(file, { buffer: Buffer.alloc(content.length - 1) }),
  {
    code: 'ERR_INVALID_ARG_VALUE',
    name: 'TypeError',
    message: `The property 'options.buffer.byteLength' is smaller than the file size of ${content.length} bytes. Received ${content.length - 1}`,
  },
);
assert.throws(
  () => fs.readFileSync(file, { buffer: {} }),
  {
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
    message: 'The "options.buffer" property must be of type function or an instance of Buffer, TypedArray, or DataView. Received an instance of Object',
  },
);
assert.throws(
  () => fs.readFileSync(file, { buffer: () => ({}) }),
  {
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
    message: 'The "options.buffer()" property must be an instance of Buffer, TypedArray, or DataView. Received an instance of Object',
  },
);

{
  const destination = new Uint8Array(content.length + 8);
  destination.fill(0x7e);
  const result = fs.readFileSync(file, { buffer: destination });
  assert.deepStrictEqual(result, content);
  assert.deepStrictEqual(Buffer.from(destination.subarray(0, content.length)), content);
  assert(destination.subarray(content.length).every((byte) => byte === 0x7e));
}

(async () => {
  {
    const destination = Buffer.alloc(content.length + 16, 0x7a);
    assertDestination(await readFile(file, { buffer: destination }), destination, 0x7a);
  }

  {
    let requestedSize = -1;
    const destination = Buffer.alloc(content.length + 16, 0x7b);
    const result = await fs.promises.readFile(file, {
      buffer(size) {
        requestedSize = size;
        return destination;
      },
    });
    assert.strictEqual(requestedSize, content.length);
    assertDestination(result, destination, 0x7b);
  }

  await assert.rejects(
    fs.promises.readFile(file, { buffer: Buffer.alloc(content.length - 1) }),
    { code: 'ERR_INVALID_ARG_VALUE' },
  );

  const handle = await fs.promises.open(file, 'r');
  try {
    const destination = Buffer.alloc(content.length + 16, 0x7c);
    assertDestination(await handle.readFile({ buffer: destination }), destination, 0x7c);
  } finally {
    await handle.close();
  }

  if (common.isLinux) {
    const procFile = '/proc/self/cmdline';
    const expected = fs.readFileSync(procFile);
    assert(expected.length > 1);

    const destination = Buffer.alloc(expected.length + 16, 0x7d);
    const result = fs.readFileSync(procFile, { buffer: destination });
    assert.deepStrictEqual(result, expected);
    assert.deepStrictEqual(result, destination.subarray(0, expected.length));

    assert.throws(
      () => fs.readFileSync(procFile, { buffer: Buffer.alloc(expected.length - 1) }),
      { code: 'ERR_INVALID_ARG_VALUE' },
    );
  }
})().then(common.mustCall());
