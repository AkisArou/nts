'use strict';

// Supported behavior retained from test-assert-async.js. The upstream file's
// exact diagnostics additionally depend on callback names and V8 stack-frame
// elision, both section-13 function metadata.
const assert = require('assert');
const { test } = require('node:test');

test('static rejects and doesNotReject behavior', async () => {
  await assert.rejects(
    async () => { throw { code: 'E_ASYNC', message: 'rejected' }; },
    { code: 'E_ASYNC', message: /reject/ },
  );
  await assert.rejects(Promise.reject(new RangeError('range')), RangeError);

  const thenable = {
    then(_resolve, reject) { reject({ code: 'E_THENABLE' }); },
    catch() {},
  };
  await assert.rejects(thenable, { code: 'E_THENABLE' });

  await assert.rejects(
    assert.rejects(async () => {}, { code: 'E_MISSING' }),
    { code: 'ERR_ASSERTION', operator: 'rejects' },
  );
  await assert.rejects(
    assert.rejects(() => 42, { code: 'E_RETURN' }),
    { code: 'ERR_INVALID_RETURN_VALUE' },
  );

  await assert.doesNotReject(async () => 42);
  await assert.doesNotReject(Promise.resolve(42));
  await assert.rejects(
    assert.doesNotReject(Promise.reject(new TypeError('bad')), TypeError),
    { code: 'ERR_ASSERTION', operator: 'doesNotReject' },
  );

  const range = new RangeError('range');
  await assert.rejects(
    assert.doesNotReject(Promise.reject(range), TypeError),
    (error) => error === range,
  );
});

