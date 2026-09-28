// A secret KeyObject's own surface, against node's.
//
// Preserves node v24.20.0 lib/internal/crypto/keys.js SecretKeyObject and
// createSecretKey. Upstream's key-object tests reach this surface only after
// generating asymmetric keys, which this module does not have yet, so the
// secret half is asserted here. The expected values are node's, taken by
// running this sequence against node v24.20.0.

'use strict';

require('../common');
const assert = require('assert');
const crypto = require('crypto');

const key = crypto.createSecretKey(Buffer.from('secret'));
assert.strictEqual(key.type, 'secret');
assert.strictEqual(key.symmetricKeySize, 6);
assert.deepStrictEqual(key.export({ format: 'jwk' }), { kty: 'oct', k: 'c2VjcmV0' });
assert.strictEqual(key.export().toString(), 'secret');
assert.strictEqual(Object.prototype.toString.call(key), '[object KeyObject]');
assert(key instanceof crypto.KeyObject);

// The bytes are copied: a key does not change when its source does.
const source = Buffer.from('abc');
const copied = crypto.createSecretKey(source);
source[0] = 0;
assert.strictEqual(copied.export().toString('hex'), '616263');

// Text with an encoding.
assert.strictEqual(crypto.createSecretKey('6162', 'hex').export().toString(), 'ab');

// Equality is by type and bytes.
assert.strictEqual(key.equals(crypto.createSecretKey(Buffer.from('secret'))), true);
assert.strictEqual(key.equals(crypto.createSecretKey(Buffer.from('secreT'))), false);
assert.strictEqual(key.equals(crypto.createSecretKey(Buffer.from('secre'))), false);

// A KeyObject keys an HMAC exactly as its bytes do.
assert.strictEqual(
  crypto.createHmac('sha256', key).update('m').digest('hex'),
  crypto.createHmac('sha256', 'secret').update('m').digest('hex'));

assert.throws(() => key.equals({}), {
  code: 'ERR_INVALID_ARG_TYPE',
  message: 'The "otherKeyObject" argument must be an instance of KeyObject. Received an instance of Object',
});
assert.throws(() => new crypto.KeyObject('secret', {}), {
  code: 'ERR_INVALID_ARG_TYPE',
  message: 'The "handle" argument must be of type object. Received an instance of Object',
});
assert.throws(() => new crypto.KeyObject('x', {}), {
  code: 'ERR_INVALID_ARG_VALUE',
  message: "The argument 'type' is invalid. Received 'x'",
});
assert.throws(() => crypto.KeyObject.from({}), {
  code: 'ERR_INVALID_ARG_TYPE',
  message: 'The "key" argument must be an instance of CryptoKey. Received an instance of Object',
});
assert.throws(() => key.export({ format: 'pem' }), {
  code: 'ERR_INVALID_ARG_VALUE',
  message: "The property 'options.format' must be one of: undefined, 'buffer', 'jwk'. Received 'pem'",
});
assert.throws(() => crypto.createSecretKey(5), {
  code: 'ERR_INVALID_ARG_TYPE',
  message: 'The "key" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received type number (5)',
});
