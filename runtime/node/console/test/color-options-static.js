// Retained from pinned upstream `parallel/test-console-tty-colors.js`.
// That file ultimately compares an anonymous function through util.inspect,
// which requires excluded function metadata. These cases retain color choice
// and validation without making function names part of the contract.
'use strict';

const common = require('../common');
const assert = require('assert');
const util = require('util');
const { Writable } = require('stream');
const { Console } = require('console');

function check(isTTY, colorMode, expectedColorMode, inspectOptions) {
  const items = [1, { a: 2 }, ['foo'], { '\\a': '\\bar' }];
  let index = 0;
  const stream = new Writable({
    write: common.mustCall((chunk, encoding, callback) => {
      assert.strictEqual(chunk.trim(), util.inspect(items[index], {
        colors: expectedColorMode,
        ...inspectOptions,
      }));
      index++;
      callback();
    }, items.length),
    decodeStrings: false,
  });
  stream.isTTY = isTTY;

  const instance = new Console({
    stdout: stream,
    ignoreErrors: false,
    colorMode,
    inspectOptions,
  });
  for (const item of items) instance.log(item);
}

check(true, 'auto', true);
check(false, 'auto', false);
check(false, undefined, true, { colors: true, compact: false });
check(true, 'auto', true, { compact: false });
check(true, undefined, false, { colors: false });
check(true, true, true);
check(false, true, true);
check(true, false, false);
check(false, false, false);

const sink = new Writable({ write() {} });
for (const colorMode of [0, 'true', null, {}, [], () => {}]) {
  assert.throws(() => new Console({ stdout: sink, colorMode }), {
    code: 'ERR_INVALID_ARG_VALUE',
  });
}

for (const colorMode of [true, false, 'auto']) {
  assert.throws(() => new Console({
    stdout: sink,
    colorMode,
    inspectOptions: { colors: false },
  }), {
    code: 'ERR_INCOMPATIBLE_OPTION_PAIR',
  });
}
