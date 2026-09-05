'use strict';

// Adapter for the pinned upstream WPT sources
// test/fixtures/wpt/url/url-constructor.any.js and url-origin.any.js. Node's
// test/wpt/test-url.js runs those through a browser-style asynchronous harness;
// that launcher reserves process.argv[2] for a WPT selector while this
// profile's substitution runner reserves it for the module name. Execute the
// same checked-in vectors directly instead of weakening either harness.
const assert = require('assert');
const { URL } = require('url');

const corpus = [
  ...require(
    '../../../../third_party/node/test/fixtures/wpt/url/resources/urltestdata.json'
  ),
  ...require(
    '../../../../third_party/node/test/fixtures/wpt/url/resources/urltestdata-javascript-only.json'
  ),
];

const fields = [
  'href',
  'protocol',
  'username',
  'password',
  'host',
  'hostname',
  'port',
  'pathname',
  'search',
  'hash',
];

for (const expected of corpus) {
  if (typeof expected === 'string') continue;

  const base = expected.base === null ? undefined : expected.base;
  if (expected.failure === true) {
    assert.throws(
      () => new URL(expected.input, base),
      TypeError,
      `Parsing ${JSON.stringify(expected.input)} should fail`,
    );
    continue;
  }

  const actual = new URL(expected.input, base);
  for (const field of fields) {
    assert.strictEqual(
      actual[field],
      expected[field],
      `${field} for ${JSON.stringify(expected.input)}`,
    );
  }
  if ('searchParams' in expected) {
    assert.strictEqual(
      actual.searchParams.toString(),
      expected.searchParams,
      `searchParams for ${JSON.stringify(expected.input)}`,
    );
  }
  if ('origin' in expected) {
    assert.strictEqual(
      actual.origin,
      expected.origin,
      `origin for ${JSON.stringify(expected.input)}`,
    );
  }
}
