'use strict';

// Deterministic behavior retained from pinned Node v24.20.0
// parallel/test-util-styletext.js. Its final environment branch skips without
// a TTY fd, causing the harness to discard all earlier assertions.
const assert = require('assert');
const { styleText } = require('util');

const noStream = { validateStream: false };
assert.strictEqual(styleText('red', 'test', noStream), '\u001b[31mtest\u001b[39m');
assert.strictEqual(styleText('grey', 'test', noStream), '\u001b[90mtest\u001b[39m');
assert.strictEqual(styleText('bgGrey', 'test', noStream), '\u001b[100mtest\u001b[49m');
assert.strictEqual(
  styleText(['bold', 'red'], 'test', noStream),
  '\u001b[1m\u001b[31mtest\u001b[39m\u001b[22m',
);
assert.strictEqual(
  styleText('red', `A${styleText('blue', 'B', noStream)}C`, noStream),
  '\u001b[31mA\u001b[34mB\u001b[31mC\u001b[39m',
);
assert.strictEqual(
  styleText('dim', `A${styleText('bold', 'B', noStream)}C`, noStream),
  '\u001b[2mA\u001b[1mB\u001b[22m\u001b[2mC\u001b[22m',
);
assert.strictEqual(styleText('none', 'test'), 'test');
assert.throws(() => styleText('invalid', 'text', noStream), {
  code: 'ERR_INVALID_ARG_VALUE',
});
assert.throws(() => styleText(['red', 'invalid'], 'text', noStream), {
  code: 'ERR_INVALID_ARG_VALUE',
});
assert.throws(() => styleText('red', 'text', { stream: {} }), {
  code: 'ERR_INVALID_ARG_TYPE',
});

