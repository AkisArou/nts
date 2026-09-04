'use strict';

// Supported comparison behavior retained from test-assert-deep-with-error.js.
// Its upstream diagnostics require prototype-preserving copies and hidden
// property descriptors solely to render Error causes in V8's exact form.
const assert = require('assert');

assert.deepStrictEqual(
  new Error('outer', { cause: new Error('inner') }),
  new Error('outer', { cause: new Error('inner') }),
);
assert.notDeepStrictEqual(
  new Error('outer', { cause: new Error('left') }),
  new Error('outer', { cause: new Error('right') }),
);
assert.notDeepStrictEqual(
  new Error('outer'),
  new Error('outer', { cause: undefined }),
);
assert.deepEqual(
  new TypeError('outer', { cause: { code: 7 } }),
  new TypeError('outer', { cause: { code: 7 } }),
);

