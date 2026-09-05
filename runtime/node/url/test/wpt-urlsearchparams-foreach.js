'use strict';

// Adapter for the pinned upstream WPT source
// test/fixtures/wpt/url/urlsearchparams-foreach.any.js. Node's WPT launcher
// runs the source in a Worker, where this profile's module substitution cannot
// install its URL globals. Execute the unchanged source in this already-shaped
// process with only the assertion vocabulary that file uses.
const assert = require('assert');

globalThis.test = (body) => body();
globalThis.assert_equals = assert.strictEqual;
globalThis.assert_array_equals = assert.deepStrictEqual;
globalThis.assert_unreached = (message) => {
  assert.fail(`Reached unreachable code: ${message}`);
};

require(
  '../../../../third_party/node/test/fixtures/wpt/url/' +
  'urlsearchparams-foreach.any.js'
);
