'use strict';

// Public, statically representable behavior retained from pinned Node v24.20.0
// parallel/test-readline-csi.js. Its private-internal opening assertions require
// a callable function object with dynamically attached CSI constants.
const common = require('../common');
const assert = require('assert');
const readline = require('readline');
const { Writable } = require('stream');

class Capture extends Writable {
  constructor() {
    super();
    this.data = '';
  }

  _write(chunk, encoding, callback) {
    this.data += chunk.toString();
    callback();
  }

  take() {
    const data = this.data;
    this.data = '';
    return data;
  }
}

const output = new Capture();

assert.strictEqual(readline.clearScreenDown(output), true);
assert.strictEqual(output.take(), '\x1b[0J');
assert.strictEqual(
  readline.clearScreenDown(output, common.mustCall()),
  true,
);
assert.strictEqual(output.take(), '\x1b[0J');

for (const [direction, sequence] of [
  [-1, '\x1b[1K'],
  [0, '\x1b[2K'],
  [1, '\x1b[0K'],
]) {
  assert.strictEqual(readline.clearLine(output, direction), true);
  assert.strictEqual(output.take(), sequence);
}

for (const [dx, dy, sequence] of [
  [0, 0, ''],
  [1, 0, '\x1b[1C'],
  [-1, 0, '\x1b[1D'],
  [0, 1, '\x1b[1B'],
  [0, -1, '\x1b[1A'],
  [1, 1, '\x1b[1C\x1b[1B'],
  [-1, -1, '\x1b[1D\x1b[1A'],
]) {
  assert.strictEqual(readline.moveCursor(output, dx, dy), true);
  assert.strictEqual(output.take(), sequence);
}

assert.strictEqual(readline.cursorTo(output, 1), true);
assert.strictEqual(output.take(), '\x1b[2G');
assert.strictEqual(readline.cursorTo(output, 1, 2), true);
assert.strictEqual(output.take(), '\x1b[3;2H');

assert.throws(
  () => readline.cursorTo(output, 'x', 1),
  { code: 'ERR_INVALID_CURSOR_POS' },
);
assert.throws(
  () => readline.cursorTo(output, NaN),
  { code: 'ERR_INVALID_ARG_VALUE' },
);
assert.throws(
  () => readline.clearLine(output, 0, null),
  { code: 'ERR_INVALID_ARG_TYPE' },
);
assert.throws(
  () => readline.clearScreenDown(output, null),
  { code: 'ERR_INVALID_ARG_TYPE' },
);

assert.strictEqual(readline.cursorTo(undefined, 1), true);
assert.strictEqual(readline.moveCursor(null, 1, 1), true);
assert.strictEqual(readline.clearLine(undefined, 0), true);
assert.strictEqual(readline.clearScreenDown(null), true);

readline.cursorTo(undefined, 1, common.mustCall());
readline.moveCursor(null, 1, 1, common.mustCall());
readline.clearLine(undefined, 0, common.mustCall());
readline.clearScreenDown(null, common.mustCall());
