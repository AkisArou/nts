// Flags: --no-warnings
'use strict';

// The statically representable portion of pinned Node
// test/parallel/test-process-emitwarning.js. Its two omitted cases replace an
// individual Error's toString method, which requires a Section 13 property map.
const common = require('../../../../third_party/node/test/common');
const assert = require('assert');

const message = 'A Warning';
const code = 'CODE001';
const detail = 'Some detail';
const type = 'CustomWarning';

const expected = [
  { name: 'Warning' },
  { name: type },
  { name: 'Warning' },
  { name: type },
  { name: type, code },
  { name: type },
  { name: type, code },
  { name: type, code, detail },
  { name: type, code },
  { name: type, code },
  { name: type, code },
  { name: type, code },
  { name: type, code },
];
let warningIndex = 0;
process.on('warning', common.mustCall((warning) => {
  const wanted = expected[warningIndex++];
  assert(wanted !== undefined);
  assert.strictEqual(warning.name, wanted.name);
  assert.strictEqual(warning.message, message);
  assert.strictEqual(warning.code, wanted.code);
  assert.strictEqual(warning.detail, wanted.detail);
}, 13));

class CustomWarning extends Error {
  constructor() {
    super(message);
    this.name = type;
    this.code = code;
  }
}

for (const args of [
  [message],
  [message, type],
  [message, CustomWarning],
  [message, type, CustomWarning],
  [message, type, code],
  [message, { type }],
  [message, { type, code }],
  [message, { type, code, detail }],
  [new CustomWarning()],
  [message, { type, code, detail: true }],
  [message, { type, code, detail: [] }],
  [message, { type, code, detail: null }],
  [message, { type, code, detail: 1 }],
]) {
  process.emitWarning(...args);
}

for (const args of [
  [1],
  [{}],
  [true],
  [[]],
  ['', '', {}],
  ['', 1],
  ['', '', 1],
  ['', true],
  ['', '', true],
  ['', []],
  ['', '', []],
  [],
  [undefined, 'foo', 'bar'],
  [undefined],
]) {
  assert.throws(
    () => process.emitWarning(...args),
    { code: 'ERR_INVALID_ARG_TYPE', name: 'TypeError' },
  );
}
