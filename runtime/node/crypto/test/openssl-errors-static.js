// OpenSSL's errors, in the two shapes node reports them.
//
// Preserves node v24.20.0 src/crypto/crypto_util.cc ThrowCryptoError and
// CryptoErrorStore. A failure thrown from a context -- createHash with a
// digest no provider implements -- carries OpenSSL's oldest error as its
// message, `library`, `reason` and a `code` built from them, and the rest as
// `opensslErrorStack`. A failed derivation job reports the same message
// undecorated. A name OpenSSL does not know reaches it as nothing, so the
// message is node's own words and nothing else is set. The expected values are
// node's, taken by running this sequence against node v24.20.0 (OpenSSL 3.5).
//
// md4 is in OpenSSL's legacy provider, which is not loaded by default; a
// system whose default configuration loads it has no failure to observe.

'use strict';

require('../common');
const assert = require('assert');
const crypto = require('crypto');

let unsupported = null;
try {
  crypto.createHash('md4');
} catch (error) {
  unsupported = error;
}

if (unsupported !== null) {
  assert.strictEqual(unsupported.constructor, Error);
  assert.strictEqual(unsupported.message, 'error:0308010C:digital envelope routines::unsupported');
  assert.strictEqual(unsupported.code, 'ERR_OSSL_EVP_UNSUPPORTED');
  assert.strictEqual(unsupported.library, 'digital envelope routines');
  assert.strictEqual(unsupported.reason, 'unsupported');
  assert(Array.isArray(unsupported.opensslErrorStack));
  assert(unsupported.opensslErrorStack.some((line) => /initialization error/.test(line)));

  assert.throws(() => crypto.pbkdf2Sync('p', 's', 1, 4, 'md4'), (error) => {
    assert.strictEqual(error.message, 'error:0308010C:digital envelope routines::unsupported');
    assert.strictEqual(error.code, undefined);
    assert.strictEqual(error.library, undefined);
    return true;
  });
}

assert.throws(() => crypto.createHash('nope'), (error) => {
  assert.strictEqual(error.constructor, Error);
  assert.strictEqual(error.message, 'Digest method not supported');
  assert.deepStrictEqual(Object.keys(error), []);
  return true;
});

assert.throws(() => crypto.createHash('sha256', { outputLength: 5 }), {
  code: 'ERR_OSSL_EVP_NOT_XOF_OR_INVALID_LENGTH',
  library: 'digital envelope routines',
  reason: 'not XOF or invalid length',
});

// Zero bytes of PBKDF2 or HKDF is a failure with nothing queued, in node.
assert.throws(() => crypto.pbkdf2Sync('p', 's', 1, 0, 'sha256'), { message: 'Deriving bits failed' });
assert.throws(() => crypto.hkdfSync('sha256', 'k', 's', 'i', 0), { message: 'Deriving bits failed' });
assert.strictEqual(crypto.scryptSync('p', 's', 0).length, 0);

const heap = crypto.secureHeapUsed();
assert.strictEqual(heap.total, 0);
assert.strictEqual(heap.used, 0);
assert(Number.isNaN(heap.utilization));
assert.strictEqual(heap.min, 2);
assert.strictEqual(crypto.getFips(), 0);
