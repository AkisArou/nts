'use strict';

// Functional object-URL behavior from test-blob-createobjecturl.js. The
// upstream file additionally asserts `.constructor` class-object identity.

const common = require('../common');
const assert = require('assert');
const { Blob, resolveObjectURL } = require('buffer');
const { URL } = require('url');

(async () => {
  const original = new Blob(['hello'], { type: 'text/plain' });
  const id = URL.createObjectURL(original);
  assert.match(id, /^blob:nodedata:[0-9a-f-]{36}$/);

  const resolved = resolveObjectURL(id);
  assert(resolved instanceof Blob);
  assert.notStrictEqual(resolved, original);
  assert.strictEqual(resolved.type, 'text/plain');
  assert.strictEqual(await resolved.text(), 'hello');
  assert.strictEqual(await resolveObjectURL(`${id}#fragment`).text(), 'hello');
  assert.strictEqual(await resolveObjectURL(`${id}?query`).text(), 'hello');
  assert.strictEqual(await resolveObjectURL(` ${id} `).text(), 'hello');
  assert.strictEqual(await resolveObjectURL(id.replace('blob:', 'bl\nob:')).text(), 'hello');

  URL.revokeObjectURL(`${id}#fragment`);
  URL.revokeObjectURL(id);
  assert.strictEqual(resolveObjectURL(id), undefined);
  assert.strictEqual(resolveObjectURL('not a url'), undefined);
  assert.throws(() => URL.createObjectURL({}), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
})().then(common.mustCall());
