'use strict';

// `util.inspect()` discovers a runtime symbol hook, which is a §13 non-goal.
// The formatting algorithm itself remains a normal typed Buffer method.

require('../common');
const assert = require('assert');

assert.strictEqual(Buffer.from('fhqwhgads').inspect(),
                   '<Buffer 66 68 71 77 68 67 61 64 73>');
assert.strictEqual(Buffer.alloc(0).inspect(), '<Buffer >');
assert.match(Buffer.alloc(51, 'x').inspect(),
             /^<Buffer (?:78 ){50}\.\.\. 1 more byte>$/);
assert.match(Buffer.alloc(52, 'x').inspect(), /\.\.\. 2 more bytes>$/);
