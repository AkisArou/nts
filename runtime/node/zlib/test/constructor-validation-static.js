'use strict';

// Applicable validation retained from pinned Node v24.20.0
// test-zlib-deflate-constructors.js and
// test-zlib-invalid-arg-value-brotli-compress.js. Those files invoke classes
// without `new`, which is outside the statically typed runtime profile.
const assert = require('assert');
const zlib = require('zlib');

function invalidOptions(options, code) {
  assert.throws(() => new zlib.Deflate(options), { code });
}

for (const chunkSize of ['test', -Infinity, 0]) {
  invalidOptions(
    { chunkSize },
    typeof chunkSize === 'string' ? 'ERR_INVALID_ARG_TYPE' : 'ERR_OUT_OF_RANGE',
  );
}

for (const windowBits of ['test', -Infinity, Infinity, 0]) {
  invalidOptions(
    { windowBits },
    typeof windowBits === 'string' ? 'ERR_INVALID_ARG_TYPE' : 'ERR_OUT_OF_RANGE',
  );
}

for (const level of ['test', -Infinity, Infinity, -2]) {
  invalidOptions(
    { level },
    typeof level === 'string' ? 'ERR_INVALID_ARG_TYPE' : 'ERR_OUT_OF_RANGE',
  );
}

for (const memLevel of ['test', -Infinity, Infinity, -2]) {
  invalidOptions(
    { memLevel },
    typeof memLevel === 'string' ? 'ERR_INVALID_ARG_TYPE' : 'ERR_OUT_OF_RANGE',
  );
}

for (const strategy of ['test', -Infinity, Infinity, -2]) {
  invalidOptions(
    { strategy },
    typeof strategy === 'string' ? 'ERR_INVALID_ARG_TYPE' : 'ERR_OUT_OF_RANGE',
  );
}

invalidOptions({ dictionary: 'not a buffer' }, 'ERR_INVALID_ARG_TYPE');

for (const level of ['test', -Infinity, Infinity, -2]) {
  const stream = new zlib.Deflate();
  assert.throws(
    () => stream.params(level, zlib.constants.Z_DEFAULT_STRATEGY),
    { code: typeof level === 'string' ? 'ERR_INVALID_ARG_TYPE' : 'ERR_OUT_OF_RANGE' },
  );
  stream.destroy();
}

for (const strategy of ['test', -Infinity, Infinity, -2]) {
  const stream = new zlib.Deflate();
  assert.throws(
    () => stream.params(0, strategy),
    { code: typeof strategy === 'string' ? 'ERR_INVALID_ARG_TYPE' : 'ERR_OUT_OF_RANGE' },
  );
  stream.destroy();
}

assert.throws(
  () => zlib.createBrotliCompress({
    params: { [zlib.constants.BROTLI_PARAM_MODE]: 'not a number' },
  }),
  { code: 'ERR_INVALID_ARG_TYPE' },
);

const valid = new zlib.Deflate({
  strategy: zlib.constants.Z_FILTERED,
  chunkSize: zlib.constants.Z_MIN_CHUNK,
});
valid.destroy();
assert.strictEqual(zlib.constants.Z_MAX_CHUNK, Infinity);
